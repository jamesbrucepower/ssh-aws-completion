(function() {

	var AWS = require('aws-sdk');
	var fs = require('fs');
	var _ = require('underscore');
	var util = require('util');
	var argv = require('optimist')
		.usage('Usage: $0 --user [USER] --proxyuser [USER] --lb [LOAD BALANCER]')
		.default ('user', 'root')
		.default ('proxyuser', 'ec2-user')
		.argv;

	var Time = function() {}
	Time.second = 1000;
	Time.minute = Time.second * 60;
	Time.hour 	= Time.minute * 60;
	Time.day 	= Time.hour * 24;
	Time.week 	= Time.day * 7;
	Time.month 	= Time.day * 30;

	var mapObject = _.compose(_.object, _.map);

	var InstanceCompletion = function() {
		
	 	if ((this instanceof arguments.callee) === false)
	        return new arguments.callee();

		this.lbMetaChar = '%';
		this.instanceMetaChar = '^';
		this.padChar = '\u00A0';
		this.CACHED_PREFIX = '/tmp/cache.';
		this.MIN_CACHE_TIME = Time.minute * 5; // Cached for 5mins

		AWS.config.update(this.createConfig());

		this.ec2 = new AWS.EC2();
		this.elb = new AWS.ELB();

		this.commandLine = process.env.COMP_LINE;
		this.point = process.env.COMP_POINT;
	}

	_.extend(InstanceCompletion.prototype, {

		// Useful addition to underscore, converts a _.map array into an object
		createConfig: function() {
			var accessKey = process.env.AWS_ACCESS_KEY_ID;
			var secretKey = process.env.AWS_SECRET_ACCESS_KEY;
			var region = process.env.AWS_DEFAULT_REGION; 

			if (!accessKey || !secretKey || !region) {
				console.error("You must define AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION environment variables");
				process.exit(1);
			} else
				return {
					"aws_access_key_id": accessKey,
					"aws_secret_access_key": secretKey,
					"region": region 
				}
		},

		cacheDataWithName: function(options) {
			if (!options || !options.name || !options.data) return;
			fs.writeFileSync(this.CACHED_PREFIX + options.name, JSON.stringify(options.data));
		},

		isRecentlyCached: function(mTime) {
			var now = new Date();
			if (!_.isDate(mTime))
				mTime = new Date(mTime.toString());
			return (now.getTime() - mTime.getTime()) < this.MIN_CACHE_TIME;
		},

		getCachedDataWithName: function(name) {
			if (fs.existsSync(this.CACHED_PREFIX + name)) {
				var stats = fs.statSync(this.CACHED_PREFIX + name);
				if (stats.isFile() && this.isRecentlyCached(stats.mtime)) {
					console.error('reading',name,'from cache');
					var data = fs.readFileSync(this.CACHED_PREFIX + name, 'utf8');
					return JSON.parse(data);
				}
			}
			return null;
		},

		getLoadBalancers: function(loadBalancerName, cb) {
			var list;
			var params = {};
			var self = this;

			if (typeof(loadBalancerName) == 'function') {
				cb = loadBalancerName;
				list = this.getCachedDataWithName('lb');
				if (list) return cb(null, list);
			} else {
				params['LoadBalancerNames'] = loadBalancerName;
			}

			console.error('reading lb from aws');
			this.elb.describeLoadBalancers(params, function(err, data) {
				if (err) {
					cb(err);
				} else {
					list = mapObject(data.LoadBalancerDescriptions, function(lb) {
						return [lb.LoadBalancerName, _.pluck(lb.Instances,'InstanceId')];
					});
					self.cacheDataWithName({ name: 'lb', data: list });
					cb(null, list);
				}
			});
		},

		getInstancesFromLoadBalancer: function(loadBalancerName, cb) {
			var params = {
				"LoadBalancerName": loadBalancerName
			};
			this.elb.describeInstanceHealth(params, function(err, data) {
				if (err) {
					cb(err);
				} else {
					var result = {};
					_.each(data.InstanceStates, function(instance) {
						result[instance.InstanceId] = {
							"State": instance.State
						}
					});
					cb(null, result);
				}
			});
		},

		getTagFromInstance: function(key, instance) {
			return _.pluck(instance.Tags, key);
		},

		getInstancesData: function(instances, cb) {
			var self = this;
			var params = {};
			if (typeof(instances) == 'function') {
				cb = instances;
				instances = this.getCachedDataWithName('instances');
				if (instances) return cb(null, instances);
				instances = {};
			} else {
				params["InstanceIds"] = _.keys(instances)
			};

			console.error('reading instances from aws');
			this.ec2.describeInstances(params, function(err, data) {
				if (err) {
					cb(err);
				} else {
					_.each(data.Reservations, function(reservation) {
						_.each(reservation.Instances, function(i) {
							//console.error(JSON.stringify(i, 0, 4));
							instances[i.InstanceId] = instances[i.InstanceId] || {};
							_.extend(instances[i.InstanceId], _.pick(i, 'PrivateIpAddress', 'PublicIpAddress', 'SubnetId', 'VpcId'));
							_.extend(instances[i.InstanceId], {
								"Zone": i.Placement.AvailabilityZone,
								"LaunchTime": new Date(i.LaunchTime)
							});
							instances[i.InstanceId].State = instances[i.InstanceId].State || i.State.Name;
						})
					});
					self.cacheDataWithName({ name: 'instances', data: instances });
					cb(null, instances);
				}
			});
		},

		getInstancesAttribute: function(instances, attribute, cb) {
			var params = {
				"InstanceIds": instances
			};
			this.ec2.describeInstances(params, function(err, data) {
				if (err) {
					cb(err);
				} else {
					var result = {};
					_.each(data.Reservations, function(reservation) {
						var instance = reservation.Instances.shift();
						result[instance.InstanceId] = instance[attribute];
					})
					cb(null, result);
				}
			});
		},

		
		getSubnetsFromAssociation: function(associations) {
			return _.map(associations, function(association) {
				if (!association) 
					return;
				else if (association.Main)
					return 'default';
				else 
					return association.SubnetId;
			});
		},

		findDefaultRoute: function(routeTable) {
			var self = this;
			var subnets = self.getSubnetsFromAssociation(routeTable.Associations);
			var defaultRoute = _.filter(routeTable.Routes, function(route) {
				return (route.DestinationCidrBlock == "0.0.0.0/0" && !_.isUndefined(route.InstanceId));
			});	
			var result = {};
			if (subnets && subnets.length && defaultRoute && defaultRoute.length) {			
				_.each(subnets, function(subnet) {
					result[subnet] = defaultRoute[0].InstanceId;
				});
			}
			return result;
		},

		getRouteTable: function(params, cb) {
			var self = this;
			self.ec2.describeRouteTables(params, function(err, data) {
				if (err) {
					cb(err);
				} else {
					var result = {};
					_.each(data.RouteTables, function(routeTable) {
						_.each(self.findDefaultRoute(routeTable), function(v, k) {
							result[k] = {
								"NatInstanceId": v
							}; 
						});
					});
					cb(null, result);
				}
			});
		},

		createMainRouteTableFilter: function() {
			return {
				"Name": "association.main",
				"Values": ["true"]
			}
		},

		createVPCFilter: function(vpcIds) {
			return {
				"Name": "vpc-id",
				"Values": vpcIds
			}
		}, 

		createSubnetFilter: function(subnets) {
			return {
				"Name": "association.subnet-id",
				"Values": subnets
			}
		},

		mergeCollectionValues: function(c1, c2) {
			_.each(c1, function(v, k) {
				c2[k] = c2[k] || {};
				_.extend(c2[k], v);
			});
		},

		getNatInstanceIdsForSubnets: function(subnets, cb) {
			var self = this;
			if (!subnets) return cb();
			var params = {};
			params.Filters = [
				self.createMainRouteTableFilter(), 
				self.createVPCFilter(_.uniq(_.pluck(subnets,'vpcId')),false)	
			];
			self.getRouteTable(params, function(err, defaultRouteTable) {
				if (err) {
					cb(err);
				} else {
					self.mergeCollectionValues(defaultRouteTable, subnets);
					params.Filters[0] = self.createSubnetFilter(_.keys(subnets));
					self.getRouteTable(params, function(err, routeTable) {
						if (err) {
							cb(err);
						} else {
							self.mergeCollectionValues(routeTable, subnets);
							cb(null, subnets);
						}
					})
				}
			})
		},

		getSubnets: function(instances) {
			var result = {};
			_.each(instances, function(i) { 
				if (!_.isUndefined(i.SubnetId))
					result[i.SubnetId] = {
						"vpcId": i.VpcId
					};
			});
			return result;
		},

		stringAgoFromTime: function(time) {
			var now = new Date();
			if (!_.isDate(time))
				time = new Date(time.toString());
			var seconds = now.getTime() - time.getTime();
			switch (true) {
				case (seconds > Time.week):
					return util.format('%dw', Math.floor(seconds / Time.week));
					break;
				case (seconds > Time.day):
					return util.format('%dd', Math.floor(seconds / Time.day));
					break;
				case (seconds > Time.hour):
					return util.format('%dh', Math.floor(seconds / Time.hour));
					break;
				case (seconds > Time.minute):
					return util.format('%dm', Math.floor(seconds / Time.minute));
					break;
				default:
					return util.format('%ds', Math.floor(seconds));
			}
		},

		showError: function(err) {
			console.error(err);
			console.trace();
		},

		instancesToLoadBalancers: function(loadBalancers) {
			var instances = {};
			_.each(loadBalancers, function(ids, lb) {
				_.each(ids, function(id) {
					instances[id] = lb;
				});
			});
			return instances;
		},

		pad: function(inputString, length) {
			var self = this;
			_(length - inputString.length).times(function(n) { 
				inputString = inputString + self.padChar 
			});
			return inputString;
		},

		getMaxColumnLengths: function(list) {
			var columnLengths = [];
			_.each(list, function(columns) {
				for (i = 0; i < columns.length; i++) {
					columnLengths[i] = columnLengths[i] || columns[i].length;
					if (columns[i].length > columnLengths[i])
						columnLengths[i] = columns[i].length;
				}
			});
			return columnLengths;
		},

		columnAlignCommaSeparate: function(list) {
			var self = this;
			var columns = this.getMaxColumnLengths(list);
			_.each(list, function(element) {
				_(element.length).times(function(n) {
					process.stdout.write(self.pad(element[n], columns[n]));
					if (n < element.length - 1) process.stdout.write(',');
				});
				process.stdout.write('\n');
			});
		},

		processInput: function() {
			var self = this;
			if (self.commandLine && self.point) {
				var words = self.commandLine.slice(0, self.point).split(' ');
				var currentWord = words.slice(-1)[0];
				var lbMetaCharOffset = currentWord.indexOf(self.lbMetaChar);
				var instanceMetaCharOffset = currentWord.indexOf(self.instanceMetaChar);
				
				// If the current words contains the lbMetaChar we need to match the load balancers
				if (lbMetaCharOffset >= 0) {
					// get a list of load balancers
					self.getLoadBalancers(function(err, loadBalancers) {
						if (err) {
							self.showError(err);
						} else {
							// If the last character of the current word is the meta character show all load balancers
							if (currentWord.slice(-1)[0] === self.lbMetaChar) {
								console.log(_.keys(loadBalancers).join('\n'));
								process.exit(0);

							// If the meta character offset is before the end of the word
							} else {
								var prefix = currentWord.slice(0, lbMetaCharOffset + 1);
								//prefix = prefix.replace(/^.*@/,'\@');
								var matches = _.filter(_.keys(loadBalancers), function(lb) {
									var suffix = currentWord.slice(lbMetaCharOffset + 1, lbMetaCharOffset + 1 + lb.length);
									return lb.indexOf(suffix) == 0;
								});
								if (matches.length == 1) {
									var loadBalancer = matches[0];
									self.getInstancesFromLoadBalancer(loadBalancer, function(err, instances) {
										if (err) {
											self.showError(err);
										} else {
											if (_.size(instances) > 0) {
												self.getInstancesData(instances, function(err, instances) {
													if (err) {
														self.showError(err);
													} else {
														var subnets = self.getSubnets(instances);
														self.getNatInstanceIdsForSubnets(subnets, function(err, natInstanceIds) {
															if (err) {
																self.showError(err);
															} else {
																if (natInstanceIds) {
																	var id = _.compact(_.pluck(subnets,'NatInstanceId'));
																	self.getInstancesAttribute(id, 'PublicIpAddress', function(err, ips) {
																		if (err) {
																			self.showError(err);
																		} else {
																			suffix = currentWord.slice(lbMetaCharOffset, currentWord.length);
																			_.each(instances, function(instance, id) {
																				var match = util.format("%s%s,%s,%s,%s,%s,%s,%s,%s,%s",
																					prefix,
																					loadBalancer,
																					id,
																					instance.State,
																					self.stringAgoFromTime(instance.LaunchTime),
																					instance.SubnetId,
																					instance.VpcId,
																					instance.Zone,
																					ips[natInstanceIds[instance.SubnetId].NatInstanceId] || ips[natInstanceIds['default'].NatInstanceId],
																					instance.PrivateIpAddress);
																				if (match.indexOf(suffix) == 0)
																					console.log(match);
																			});
																			process.exit(0);
																		}
																	});
																} else {
																	var suffix = currentWord.slice(lbMetaCharOffset, currentWord.length);
																	_.each(instances, function(instance, id) {
																		var match = util.format("%s%s,%s,%s,%s,%s,%s,%s,%s,%s",
																			prefix,
																			loadBalancer,
																			id,
																			instance.State,
																			self.stringAgoFromTime(instance.LaunchTime),
																			'-',
																			'-',
																			instance.Zone,
																			'-',
																			instance.PublicIpAddress);
																		if (match.indexOf(suffix) == 0)
																			console.log(match);
																	});
																	process.exit(0);
																}
															}
														});
													}
												});
											} else {
												console.log(prefix + loadBalancer);
												process.exit(0);
											}
										}
									});
								} else {
									_.each(matches, function(match) {
										console.log(prefix + match);
									});
									process.exit(0);
								}
							}
						}
					});
				} else if (instanceMetaCharOffset >= 0) {
					self.getLoadBalancers(function(err, loadBalancers) {
						if (err) {
							showError(err)
						} else {
							var prefix = currentWord.slice(0, instanceMetaCharOffset + 1);
							var suffix = currentWord.slice(instanceMetaCharOffset, currentWord.length);
							var loadBalancerMap = self.instancesToLoadBalancers(loadBalancers);
							self.getInstancesData(function(err, instances) {
								if (err) {
									self.showError(err);
								} else {
									var subnets = self.getSubnets(instances);
									self.getNatInstanceIdsForSubnets(subnets, function(err, subnets) {
										if (err) {
											self.showError(err);
										} else {
											if (subnets) {
												var id = _.compact(_.pluck(subnets,'NatInstanceId'));
												self.getInstancesAttribute(id, 'PublicIpAddress', function(err, ips) {
													if (err) {
														self.showError(err);
													} else {
														var matches = [];
														_.each(instances, function(instance, id) {
															var match = prefix + id;
															if (match.indexOf(suffix) == 0)
																matches.push([match, 
																			  loadBalancerMap[id] || '-',
																			  instance.State || '-',
																			  self.stringAgoFromTime(instance.LaunchTime) || '-',
																		  	  instance.SubnetId || '-',
																		  	  instance.VpcId || '-',
																		  	  instance.Zone || '-',
																		  	  '-',//ips[subnets[instance.SubnetId].NatInstanceId] || ips[subnets['default'].NatInstanceId],
																		  	  instance.PublicIpAddress || instance.PrivateIpAddress || '-']);

														/*	var match = util.format("%s%s,%s,%s,%s,%s,%s,%s,%s,%s",
																					prefix,
																					id, 
																					loadBalancerMap[id] || '-',
																					instance.State || '-',
																					self.stringAgoFromTime(instance.LaunchTime),
																					instance.SubnetId || '-',
																					instance.VpcId || '-',
																					instance.Zone,
																					'-',//ips[subnets[instance.SubnetId].NatInstanceId] || ips[subnets['default'].NatInstanceId],
																					instance.PublicIpAddress || instance.PrivateIpAddress || '-');
															if (match.indexOf(suffix) == 0)
																console.log(match);*/
														});
														self.columnAlignCommaSeparate(matches);
														process.exit(0);
													}
												});
											}
										}
									});
								}
							});
						}
					});
				}
			}
		}
	});

	var instanceCompletion = new InstanceCompletion();
	instanceCompletion.processInput();

}).call(this);