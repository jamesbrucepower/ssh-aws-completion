var _ 		= require('underscore');
var util 	= require('util');

var Time = {};
Time.second = 1000;
Time.minute = Time.second * 60;
Time.hour 	= Time.minute * 60;
Time.day 	= Time.hour * 24;
Time.week 	= Time.day * 7;
Time.month 	= Time.day * 30;	
Time.stringAgoFromTime = function(aTime) {
	if (!aTime) return;
	var now = new Date();
	if (!_.isDate(aTime))
		aTime = new Date(aTime.toString());
	var seconds = now.getTime() - aTime.getTime();
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
}

if (!_.isUndefined(exports)) {
	exports.Time = Time;
}