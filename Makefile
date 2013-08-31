PATH := ${PATH}:/usr/local/bin:./node_modules/.bin/
REPORTER = spec

test:
	@NODE_ENV=test ./node_modules/.bin/mocha -R $(REPORTER)
	
lib-cov:
	@jscoverage --no-highlight lib lib-cov
	
coverage: lib-cov
	-@MOCHA_COV=1 $(MAKE) test REPORTER=html-cov > coverage.html
	-@open coverage.html
        	
debug:
	@NODE_ENV=test ./node_modules/.bin/mocha --no-colors debug -R $(REPORTER)
	
clean:
	-@[ -f coverage.html ] && rm coverage.html || exit 0
	-@[ -d lib-cov ] && rm -rf lib-cov || exit 0
	-@rm test/data/test* || exit 0
	
all: coverage
	
.PHONY: test
