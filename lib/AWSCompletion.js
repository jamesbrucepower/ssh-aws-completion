var libpath = process.env['MOCHA_COV'] ? __dirname + '/../lib-cov/' : __dirname + '/../lib/';

var AWS  = require('aws-sdk');
var fs   = require('fs');
var _ 	 = require('underscore');
var util = require('util');
var Time = require(libpath + 'Time').Time;
var argv = require('optimist').argv;
	
// Useful addition to underscore, converts a _.map array into an object
var mapObject = _.compose(_.object, _.map);

var AWSCompletion = function(options) {
	
 	if ((this instanceof arguments.callee) === false)
        return new arguments.callee(options);

	options = options || {};
	
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
	this.input = process.env.COMP_LINE || argv._.shift();
	this.offset = process.env.COMP_POINT || this.input.length;

	AWS.config.update(this.createConfig());

	this.ec2 = new AWS.EC2();
	this.elb = new AWS.ELB();
}

_.extend(AWSCompletion.prototype, {

	instanceAttributes: function() {
		return [
			'PrivateIpAddress', 
			'PublicIpAddress', 
			'SubnetId', 
			'VpcId',
			'Tags',
			'Placement',
			'LaunchTime',
			'State'
		];
	},

	showError: function(err) {
		if (err) {
			console.error(err);
			console.trace();
			return true;
		}
		return false;
	},

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

	indexOfMetaChar: function(word) {
		var indexes = _.map(this.metaChars, function(v, k) {
			var offset = word.indexOf(v);
			if (offset >= 0) return offset;
		});
		return indexes.sort().shift();
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
		return _.map(list, function(element) {
			var row = "";
			_(element.length).times(function(n) {
				row += self.pad(element[n], columns[n]);
				if (n < element.length - 1) 
					row += ',';
			});
			return row;
		});
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

	getTagFromInstance: function(key, instance) {
		return _.pluck(instance.Tags, key);
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

	mergeCollection: function(c1, c2) {
		_.each(c1, function(v, k) {
			c2[k] = c2[k] || {};
			_.extend(c2[k], v);
		});
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

	invertHash: function(hash) {
		var result = {};
		_.each(hash, function(v, k) {
			_.each(v, function(id) {
				result[id] = k;
			});
		});
		return result;
	},

	publicIpAddressForSubnet: function(subnetId) {
		if (!subnetId || !this.natips)
			return '-';
		return this.natips[this.subnets[subnetId].NatInstanceId] || this.natips[this.subnets['default'].NatInstanceId];
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

	filterByPrefix: function(prefix, list) {
		return _.filter(list, function(i) {
			return i.indexOf(prefix) == 0;
		});
	},

	filterOutput: function(err, options, self) {
		if (!self.showError(err)) {
			var matches = [];
			_.each(self.instances, function(instance, id) {
				var match = [];
				if (options.metaChar == self.metaChars.instance) 
					match = [id, self.i2lb[id]];
				else 
					match = [options.loadBalancer, id];

				if (match.join(',').indexOf(options.filter) == 0) {
					match.push(instance.State.Name || '-',
							   Time.stringAgoFromTime(instance.LaunchTime) || '-',
							   instance.SubnetId || '-',
							   instance.VpcId || '-',
							   instance.Placement.AvailabilityZone || '-',
							   self.publicIpAddressForSubnet(instance.SubnetId),
							   instance.PublicIpAddress || instance.PrivateIpAddress || '-');
					matches.push(match);		
				}
			});
			self.output(options, matches);
		}
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

	processNatInstances: function(err, options, instances, self) {
		if (!self.showError(err)) {
			self.natips = instances;
			self.filterOutput(null, options, self);
		}
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
				self.mergeCollection(defaultRouteTable, subnets);
				params.Filters[0] = self.createSubnetFilter(_.keys(subnets));
				self.getRouteTable(params, function(err, routeTable) {
					if (err) {
						cb(err, options, null, self);
					} else {
						self.mergeCollection(routeTable, subnets);
						cb(null, options, subnets, self);
					}
				})
			}
		})
	},

	processNatInstanceIdsForSubnets: function(err, options, subnets, self) {
		if (!self.showError(err)) {
			if (subnets) {
				self.subnets = subnets;
				var natInstanceIds = _.compact(_.pluck(subnets,'NatInstanceId'));
				self.getInstancesAttribute(options, natInstanceIds, 'PublicIpAddress', self.processNatInstances);
			} else {
				self.filterOutput(null, options, self);
			}
		}
	},

	getInstancesData: function(options, instances, cb) {
		var self = this;
		var params = {};
		var cachedInstances = this.getCachedDataWithName('instances-' + options.loadBalancer);
		if (cachedInstances) {
			self.instances = cachedInstances;
			return cb(null, options, self);
		}

		if (instances)
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
					})
				});
				self.cacheDataWithName({ name: 'instances-' + options.loadBalancer, data: self.instances });
				cb(null, options, self);
			}
		});
	},

	processInstancesData: function(err, options, self) {
		if (!self.showError(err)) {
			var subnets = self.getSubnets(self.instances);
			self.getNatInstanceIdsForSubnets(options, subnets, self.processNatInstanceIdsForSubnets);
		}
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
					result[instance.InstanceId] = result[instance.InstanceId] || {};
					result[instance.InstanceId].State = result[instance.InstanceId].State || {};
					result[instance.InstanceId].State.Name = instance.State;
				});
				if (_.size(result) === 0)
					result[options.loadBalancer] = {};

				cb(null, options, result, self);
			}
		});
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

	getLoadBalancers: function(options, cb) {
		var params = {};
		var self = this;
		var list = this.getCachedDataWithName('lb');

		if (list) return cb(null, options, list, self);

		if (argv.debug) console.error('reading lb from aws');
		self.elb.describeLoadBalancers(params, function(err, data) {
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

	processLoadBalancers: function(err, options, loadBalancers, self) {
		if (!self.showError(err)) {

			if (options.metaChar == self.metaChars.instance)
				self.i2lb = self.invertHash(loadBalancers);
			
			// If there is a filter then filter the load balancers
			if (options && options.filter && options.filter.length > 0) {
				var matches;
				var lbFilter = options.filter.split(',').shift();
				
				if (options.metaChar == self.metaChars.lb) 	
					matches = self.filterByPrefix(lbFilter, _.keys(loadBalancers));
				else 
					matches = self.filterByPrefix(lbFilter, _.keys(self.i2lb));

				if (options.metaChar == self.metaChars.search || matches.length == 1) {
					if (options.metaChar == self.metaChars.lb) {
						options.loadBalancer = matches.shift();	
						self.getInstancesFromLoadBalancer(options, self.processInstancesFromLoadBalancer);
					} else {
						var instances = {};
						instances[matches.shift()] = {};
						self.getInstancesData(options, instances, self.processInstancesData);
					}
					
				} else {
					self.output(options, matches);
				}

			// If there is no filter show all load balancers
			} else {
				if (options.metaChar == self.metaChars.instance) 
					self.output(options, _.keys(self.i2lb));
				else 
					self.output(options, _.keys(loadBalancers));
			}
		}
	},

	processInput: function() {
		var self = this;
		var words = self.input.slice(0, self.offset).split(' ');
		var currentWord = words.slice(-1)[0];

		var metaCharIndex = self.indexOfMetaChar(currentWord);
		var prefix = currentWord.slice(0, metaCharIndex);
		var suffix = currentWord.slice(metaCharIndex + 1, currentWord.length); 

		if (metaCharIndex >= 0) {
			
			var options = { 
				prefix: prefix,
				metaChar: currentWord[metaCharIndex] 
			};
			if (suffix.length)
				options.filter = suffix;

			// get a list of load balancers
			self.getLoadBalancers(options, self.processLoadBalancers);
		}
	},

	output: function(options, list) {
		//if (_.isArray(list))
			_.each(list.sort(), function(match) {
				console.log(options.prefix + options.metaChar + match);
			});
		process.exit(0);
	}
});

if (!_.isUndefined(exports)) {
	exports.AWSCompletion = AWSCompletion;
}