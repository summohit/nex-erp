#!/usr/bin/expect -f
# This script automatically logs into your VPS and streams the live backend logs.

set timeout -1
set IP "94.136.188.176"
set USER "root"
# Read from the environment; never hardcode it here. See deploy.sh.
if {![info exists env(NEX_DEPLOY_PASS)]} {
    puts "NEX_DEPLOY_PASS is not set - export the server password before running."
    exit 1
}
set PASSWORD $env(NEX_DEPLOY_PASS)

spawn ssh -o StrictHostKeyChecking=no $USER@$IP "pm2 logs nex-erp-backend"

expect {
    "password:" {
        send "$PASSWORD\r"
        exp_continue
    }
    eof
}
