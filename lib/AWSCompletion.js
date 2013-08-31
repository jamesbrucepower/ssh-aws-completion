var libpath = process.env['MOCHA_COV'] ? __dirname + '/../lib-cov/' : __dirname + '/../lib/';

var AWS  = require('aws-sdk');
var fs   = require('fs');
var _ 	 = require('underscore');
var util = require('util');
var Time = require(libpath + 'Time').Time;

var argv = require('optimist')
	.usage('Usage: $0 --user [USER] --proxyuser [USER] --lb [LOAD BALANCER]')
	.default ('user', 'root')
	.default ('proxyuser', 'ec2-user')
	.argv;

// Useful addition to underscore, converts a _.map array into an object
var mapObject = _.compose(_.object, _.map);

var AWSCompletion = function(options) {
	
 	if ((this instanceof arguments.callee) === false)
        return new arguments.callee(options);

	this.metaChars = {
		search: 	'/',
		instance: 	'^',
		lb: 		'%'
	}

	this.separator = ',';
	this.padChar = '\u00A0';
	this.CACHED_PREFIX = '/tmp/cache.';
	this.MIN_CACHE_TIME = Time.minute * 5; // Cached for 5mins
	this.instances = {};
	this.subnets = {};

	AWS.config.update(this.createConfig());

	this.ec2 = new AWS.EC2();
	this.elb = new AWS.ELB();

	if (options) {
		this.input = options.input || "";
		this.offset = options.offset || "";
	}
}

_.extend(AWSCompletion.prototype, {

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
		if (options && options.name && options.data) 
			fs.writeFileSync(this.CACHED_PREFIX + options.name, JSON.stringify(options.data));
	},

	isRecentlyCached: function(mTime) {
		var now = new Date();
		if (!_.isDate(mTime))
			mTime = new Date(mTime.toString());
		return (now.getTime() - mTime.getTime()) < this.MIN_CACHE_TIME;
	},

	getCachedDataWithName: function(name) {
		var fileName = this.CACHED_PREFIX + name;
		if (fs.existsSync(fileName)) {
			var stats = fs.statSync(fileName);
			if (stats.isFile() && this.isRecentlyCached(stats.mtime)) {
				if (argv.debug) console.error('reading',name,'from cache');
				var data = fs.readFileSync(fileName, 'utf8');
				return JSON.parse(data);
			}
		}
		return null;
	},

	getLoadBalancers: function(options, cb) {
		var params = {};
		var self = this;
		var list = this.getCachedDataWithName('lb');

		if (list) return cb(null, options, list, self);

		if (argv.debug) console.error('reading lb from aws');
		this.elb.describeLoadBalancers(params, function(err, data) {
			if (err) {
				cb(err, null, null, self);
			} else {
				list = mapObject(data.LoadBalancerDescriptions, function(lb) {
					return [lb.LoadBalancerName, _.pluck(lb.Instances,'InstanceId')];
				});
				self.cacheDataWithName({ name: 'lb', data: list });
				cb(null, options, list, self);
			}
		});
	},

	getInstancesFromLoadBalancer: function(options, cb) {
		var self = this;
		var params = {
			"LoadBalancerName": options.loadBalancer
		};
		this.elb.describeInstanceHealth(params, function(err, data) {
			if (err) {
				cb(err, options, null, self);
			} else {
				var result = {};
				_.each(data.InstanceStates, function(instance) {
					result[instance.InstanceId] = {
						"State": instance.State
					}
				});
				cb(null, options, result, self);
			}
		});
	},

	getTagFromInstance: function(key, instance) {
		return _.pluck(instance.Tags, key);
	},

	instanceAttributes: function() {
		return [
			'PrivateIpAddress', 
			'PublicIpAddress', 
			'SubnetId', 
			'VpcId'
		];
	},

	getInstancesData: function(options, instances, cb) {
		var self = this;
		var params = {};
		var cachedInstances = this.getCachedDataWithName('instances-' + options.loadBalancer);
		if (cachedInstances) {
			self.instances = cachedInstances;
			return cb(null, options, self);
		}

		params["InstanceIds"] = _.keys(instances);
		
		if (argv.debug) console.error('reading instances from aws');
		this.ec2.describeInstances(params, function(err, data) {
			if (err) {
				cb(err, options, self);
			} else {
				_.each(data.Reservations, function(reservation) {
					_.each(reservation.Instances, function(i) {
						self.instances[i.InstanceId] = self.instances[i.InstanceId] || {};
						_.extend(self.instances[i.InstanceId], _.pick(i, self.instanceAttributes()));
						_.extend(self.instances[i.InstanceId], {
							"Zone": i.Placement.AvailabilityZone,
							"LaunchTime": new Date(i.LaunchTime)
						});
						self.instances[i.InstanceId].State = self.instances[i.InstanceId].State || i.State.Name;
					})
				});
				self.cacheDataWithName({ name: 'instances-' + options.loadBalancer, data: self.instances });
				cb(null, options, self);
			}
		});
	},

	getInstancesAttribute: function(options, instances, attribute, cb) {
		var self = this;
		var params = {
			"InstanceIds": instances
		};
		this.ec2.describeInstances(params, function(err, data) {
			if (err) {
				cb(err, options, null, self);
			} else {
				var result = {};
				_.each(data.Reservations, function(reservation) {
					var instance = reservation.Instances.shift();
					result[instance.InstanceId] = instance[attribute];
				})
				cb(null, options, result, self);
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

	getNatInstanceIdsForSubnets: function(options, subnets, cb) {
		var self = this;
		if (!subnets) return cb();
		var params = {};
		params.Filters = [
			self.createMainRouteTableFilter(), 
			self.createVPCFilter(_.uniq(_.pluck(subnets,'vpcId')),false)	
		];
		self.getRouteTable(params, function(err, defaultRouteTable) {
			if (err) {
				cb(err, options, null, self);
			} else {
				self.mergeCollectionValues(defaultRouteTable, subnets);
				params.Filters[0] = self.createSubnetFilter(_.keys(subnets));
				self.getRouteTable(params, function(err, routeTable) {
					if (err) {
						cb(err, options, null, self);
					} else {
						self.mergeCollectionValues(routeTable, subnets);
						cb(null, options, subnets, self);
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

	showError: function(err) {
		if (err) {
			console.error(err);
			console.trace();
			return true;
		}
		return false;
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
		var output = _.map(list, function(element) {
			var row = "";
			_(element.length).times(function(n) {
				row += self.pad(element[n], columns[n]);
				if (n < element.length - 1) 
					row += ',';
			});
			return row;
		});
	},


	output: function(options, list) {
		_.each(list.sort(), function(match) {
			console.log(options.prefix + options.metaChar + match);
		});
		process.exit(0);
	},

	processInstanceAttribute: function(err, options, ips, self) {
		if (!self.showError(err)) {
			var matches = [];
			_.each(self.instances, function(instance, id) {
				switch (options.metaChar) {
					case self.metaChars.instance:
						var match = [id, self.loadBalancerMap[id]].join(',');
						if (match.indexOf(options.filter) == 0)
							matches.push([id,
										  self.loadBalancerMap[id] || '-',
										  instance.State || '-',
										  Time.stringAgoFromTime(instance.LaunchTime) || '-',
									  	  instance.SubnetId || '-',
									  	  instance.VpcId || '-',
									  	  instance.Zone || '-',
									  	  '-',//ips[self.subnets[instance.SubnetId].NatInstanceId] || ips[self.subnets['default'].NatInstanceId],
									  	  instance.PublicIpAddress || instance.PrivateIpAddress || '-']);
						break;
					case self.metaChars.lb:
						var match = [options.loadBalancer, id].join(',');
						if (match.indexOf(options.filter) == 0)
							matches.push([options.loadBalancer || '-',
										  id,
										  instance.State || '-',
										  Time.stringAgoFromTime(instance.LaunchTime) || '-',
									  	  instance.SubnetId || '-',
									  	  instance.VpcId || '-',
									  	  instance.Zone || '-',
									  	  '-',//ips[self.subnets[instance.SubnetId].NatInstanceId] || ips[self.subnets['default'].NatInstanceId],
									  	  instance.PublicIpAddress || instance.PrivateIpAddress || '-']);
						break;
				}
				
			});
			self.output(options, matches);
		}
	},
	
	filterInstancesByRegex: function(regex, instances) {
		var self = this;
		return _.filter(instances, function(instance) {
			if (_.isArray(instance))
				return instance.join(self.separator).match(regex);
			else 
				return instance.match(regex);	
		});
	},

	filterInstancesByPrefix: function(prefix, instances) {
		return _.filter(instances, function(instance) {
			return instance.indexOf(prefix) == 0;
		});
	},

	processNatInstances: function(err, options, subnets, self) {
		if (!self.showError(err)) {
			if (subnets) {
				self.subnets = subnets;
				var ids = _.compact(_.pluck(subnets,'NatInstanceId'));
				self.getInstancesAttribute(options, ids, 'PublicIpAddress', self.processInstanceAttribute);
			} else {
				var suffix = currentWord.slice(lbMetaCharOffset, currentWord.length);
				_.each(instances, function(instance, id) {
					var match = util.format("%s%s,%s,%s,%s,%s,%s,%s,%s,%s",
						prefix,
						loadBalancer,
						id,
						instance.State,
						Time.stringAgoFromTime(instance.LaunchTime),
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
	},

	processInstancesData: function(err, options, self) {
		if (!self.showError(err)) {
			var subnets = self.getSubnets(self.instances);
			self.getNatInstanceIdsForSubnets(options, subnets, self.processNatInstances);
		}
	},

	processInstancesFromLoadBalancer: function(err, options, instances, self) {
		if (!self.showError(err)) {
			if (_.size(instances) > 0) {
				self.instances = instances;
				self.getInstancesData(options, instances, self.processInstancesData);
			} else {
				self.output(options, options.loadBalancer);
			}
		}
	},

	processLoadBalancers: function(err, options, loadBalancers, self) {
		if (!self.showError(err)) {

			if (options.metaChar == self.metaChars.instance)
				self.loadBalancerMap = self.instancesToLoadBalancers(loadBalancers);
			
			// If there is a filter filter the load balancers
			if (options && options.filter && options.filter.length > 0) {
				var matches = [];
				_.each(_.keys(loadBalancers), function(lb) {
					if (lb.indexOf(options.filter) == 0)
						matches.push(lb);
				});
				if (matches.length == 1) {
					options.loadBalancer = matches.shift();
					self.getInstancesFromLoadBalancer(options, self.processInstancesFromLoadBalancer);
				} else {
					self.output(options, matches);
				}

			// If there is no filter show all load balancers
			} else {
				self.output(options, _.keys(loadBalancers));
			}
		}
	},

	indexOfMetaChar: function(word) {
		var indexes = _.map(this.metaChars, function(v, k) {
			var offset = word.indexOf(v);
			if (offset >= 0) return offset;
		});
		return indexes.sort().shift();
	},

	processInput: function() {
		var self = this;
		var words = self.input.slice(0, self.offset).split(' ');
		var currentWord = words.slice(-1)[0];

		var metaCharIndex = self.indexOfMetaChar(currentWord);
		var prefix = currentWord.slice(0, metaCharIndex); 
		var suffix = currentWord.slice(metaCharIndex + 1, currentWord.length); 

		if (metaCharIndex >= 0) {
			// get a list of load balancers
			var options = { 
				prefix: prefix,
				metaChar: currentWord[metaCharIndex] 
			};
			if (suffix.length)
				options.filter = suffix;

			self.getLoadBalancers(options, self.processLoadBalancers);
		}
	}
});

if (!_.isUndefined(exports)) {
	exports.AWSCompletion = AWSCompletion;
}