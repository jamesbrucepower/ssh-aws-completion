(function() {

	var libpath = process.env['MOCHA_COV'] ? __dirname + '/../lib-cov/' : __dirname + '/';
	var awsCompletion = require(libpath + 'AWSCompletion').AWSCompletion();
	awsCompletion.processInput();

}).call(this);