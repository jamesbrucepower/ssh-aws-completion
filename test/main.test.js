var libpath = process.env['MOCHA_COV'] ? __dirname + '/../lib-cov/' : __dirname + '/../lib/';
var fs = require('fs');
var should = require('should');
var util = require('util');
var _ = require('underscore');
var completion = require(libpath + 'AWSCompletion').AWSCompletion();
describe('AWSCompletion', function() {
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
    describe('filterInstancesByPrefix()', function () {
        it('should filter an array of objects by a prefix', function() {
            var i = ['one', 'two', 'three', 'four'];
            var result = completion.filterInstancesByPrefix('t', i);
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
    describe('processLoadBalancers()', function () {
        it('should not throw an error when processing normal input', function () {
            (function() {
                completion.input = "%"
                completion.offset = 1;
                var result = completion.processInput();
            }).should.not.throwError();
        });
    });
});