SSH Amazon Web Services Bash Completion
=======================================

Bash completion for ssh for Amazon AWS load balancers and instances

Pre-requisites
--------------

1. You need a recent version of node.js (and npm, which in recent versions is packaged with node)
2. Make sure your installation of node.js sets the NODE_PATH env variable and it points to your shared NPM node_modules directory
3. Make sure your shared NPM modules bin directory is added to your path, typically /usr/local/share/npm/bin, but sometimes /usr/share/npm/bin (depending on your distribution of node)

Installation
------------

```
npm install -g git://github.com/jamesbrucepower/ssh-aws-completion.git
```

Add the following to your bash profile

```
complete -C ssh-aws-completion ssh
```

Add the following to your .ssh/config file, replacing
* [USER] with the name of the default destination server username (can still be overridden by user@host)
* [PROXY-USER] with the name of the proxy user

```
Host %*
    User [USER]
    StrictHostKeyChecking no
    ProxyCommand ssh-aws-completion-command [PROXY-USER] %h %p
```

Usage
-----

Get a complete list of all load balancers
```
ssh %[TAB]   
```

Once you have an individual load balancer completed, it will TAB complete on individual hosts

Get a complete list of all instances
``
ssh ^[TAB]
```

