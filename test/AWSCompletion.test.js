var libpath = process.env['MOCHA_COV'] ? __dirname + '/../lib-cov/' : __dirname + '/../lib/';
var fs = require('fs');
var should = require('should');
var util = require('util');
var sinon = require('sinon');
var _ = require('underscore');
var completion = require(libpath + 'AWSCompletion').AWSCompletion();
describe('AWSCompletion', function() {
    var sandbox;
    beforeEach(function () {
        sandbox = sinon.sandbox.create();
    });

    afterEach(function () {
        sandbox.restore();
    });
    describe('cacheDataWithName()', function () {
        it('should cache data to disk with a particular name', function () {
            var testData = { one: 'apple', two: 'pears' };
            completion.cacheDataWithName({ name: 'test', data: testData});
            completion.getCachedDataWithName('test').should.eql(testData);
        });
    });
    describe('getLoadBalancers()', function () {
        it('should return a list of loadBalancers and their instance ids', function (done) {
            var loadBalancers = { 
                'LoadBalancerDescriptions': [{
                    LoadBalancerName: 'test-lb', 
                    Instances: [
                        { InstanceId: 'i-123456789'}, 
                        { InstanceId: 'i-abcdef123'} 
                    ]
                }]
            };
                
            var lbStub = sinon.stub(completion.elb, 'describeLoadBalancers').callsArgWith(1, null, loadBalancers);
            completion.getLoadBalancers({}, function(err, options, data, self) {
                data.should.eql({
                    'test-lb': ['i-123456789','i-abcdef123']
                });
                completion.elb.describeLoadBalancers.restore();
                done(err);
            })
        });
    });
    describe('getInstancesData()', function () {
        it('should fetch instance meta for a list of instances', function (done) {
           var data = JSON.parse(fs.readFileSync(__dirname + '/data/instances.json'));

            var result = {
                "PrivateIpAddress": "10.0.3.151",
                "SubnetId": "subnet-abcdef12",
                "VpcId": "vpc-12345678",
                "Tags": [{
                    "Key": "Name",
                    "Value": "foobar"
                }, {
                    "Key": "aws:autoscaling:groupName",
                    "Value": "asg00000001"
                }],
                "Placement": {
                    "AvailabilityZone": "eu-west-1b",
                    "GroupName": null,
                    "Tenancy": "default"
                },
                "LaunchTime": "2013-08-30T10:17:13.000Z",
                "State": {
                    "Code": 16,
                    "Name": "running"
                }
            };

            var instancesStub = sinon.stub(completion.ec2, 'describeInstances').callsArgWith(1, null, data);
            completion.getInstancesData({}, null, function(err, options, self) {
                //console.error(JSON.stringify(completion.instances, 0, 4));
                completion.instances['i-b245c7fd'].should.eql(result);
                _.size(completion.instances).should.equal(8);
                done(err);
            }) 
        });
    });
    describe('mergeCollection()', function () {
        it('should merge two collections together', function() {
            var src = { frog: { color: 'green' }};
            var dst = { frog: { classication: 'amphibia', type: 'tree frog'}};

            completion.mergeCollection(src, dst);
            dst.should.eql({ frog: { color: 'green', classication: 'amphibia', type: 'tree frog'}});
        });
    });
    describe('pad', function () {
        it('should pad a string to n characters', function () {
            var word = 'shark';
            var result = completion.pad(word, 10);
            result.length.should.equal(10);
        });
    });
    describe('getMaxColumnLengths', function () {
        it('should find the maximum lengths of an array of an array of strings', function () {
            var i = [['one', 'two', 'three', 'a very long four'],['apples', 'pears', 'oranges', 'grapes']];
            var result = completion.getMaxColumnLengths(i);
            result[0].should.equal(i[1][0].length);
            result[1].should.equal(i[1][1].length);
            result[2].should.equal(i[1][2].length);
            result[3].should.equal(i[0][3].length);
        });
    });
    describe('filterByPrefix()', function () {
        it('should filter an array of objects by a prefix', function() {
            var i = ['one', 'two', 'three', 'four'];
            var result = completion.filterByPrefix('t', i);
            result.length.should.equal(2);
        });
    });
    describe('filterInstancesByRegex()', function () {
        it('should filter an array of objects by a regular expression', function() {
            var i = ['one', 'two', 'three', 'four'];
            var result = completion.filterInstancesByRegex(/o/, i);
            result.length.should.equal(3);
        });
        it('should filter a nested array of objects by combining the sub objects and matching with a regular expression', function() {
            var i = [['one', 'two', 'three', 'four'],['apples', 'pears', 'oranges', 'grapes']];
            var result = completion.filterInstancesByRegex(/two/, i);
            result.length.should.equal(1);
        });
    });
    describe('indexOfMetaChar()', function () {
        it('should return the index of the first meta character', function () {
            completion.indexOfMetaChar('12345%789').should.equal(5);
            completion.indexOfMetaChar('123456789/').should.equal(9);
            completion.indexOfMetaChar('^123456789').should.equal(0);
            completion.indexOfMetaChar('a^b%cdefg/').should.equal(1);
        });
    }); 
    /*describe('processLoadBalancers()', function () {
        it('should not throw an error when processing normal input', function () {
            (function() {
                completion.input = "%"
                completion.offset = 1;
                var result = completion.processInput();
            }).should.not.throwError();
        });
    });*/
});