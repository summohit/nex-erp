#!/usr/bin/expect -f
# This script automatically logs into your VPS and streams the live backend logs.

set timeout -1
set IP "94.136.188.176"
set USER "root"
set PASSWORD "gN6V5aLNdI69"

spawn ssh -o StrictHostKeyChecking=no $USER@$IP "pm2 logs nex-erp-backend"

expect {
    "password:" {
        send "$PASSWORD\r"
        exp_continue
    }
    eof
}
