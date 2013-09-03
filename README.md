SSH Amazon Web Services Bash Completion
=======================================

Bash completion for ssh for Amazon AWS load balancers and instances

Pre-requisites
--------------

1) Make sure NODE_PATH env variable is defined and points to your shared NPM node_modules
2) Make sure your shared NPM modules bin directory is added to your path, typically /usr/local/share/npm/bin

Installation
------------

```
npm install -g ssh-aws-completion
```

Add the following to your bash profile

```
complete -C ssh-aws-completion ssh
```

Add the following to your .ssh/config file

```
Host %*
    User [USER]													# [USER] is the name of the destination server user
    StrictHostKeyChecking no
    ProxyCommand ssh-aws-completion-command [PROXY-USER] %h %p	# replace [PROXY-USER] with the the name of the proxy user
```