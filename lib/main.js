(function() {

	var libpath = process.env['MOCHA_COV'] ? __dirname + '/../lib-cov/' : __dirname + '/';
	var options = { 
		input: process.env.COMP_LINE, 
		offset: process.env.COMP_POINT
	};
	var awsCompletion = require(libpath + 'AWSCompletion').AWSCompletion(options);
	awsCompletion.processInput();

}).call(this);