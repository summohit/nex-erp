#!/bin/bash

# Define colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting nex-erp development environment...${NC}\n"

# 1. Ensure PostgreSQL is running
echo -e "${GREEN}Verifying PostgreSQL service...${NC}"
brew services start postgresql@15 > /dev/null 2>&1

# 2. Push database schema to be safe
echo -e "${GREEN}Syncing database schema...${NC}"
cd backend
npx prisma db push
cd ..

# 3. Start Backend
echo -e "${GREEN}Starting NestJS Backend API (Port 3000)...${NC}"
cd backend
npm run start:dev &
BACKEND_PID=$!
cd ..

# 4. Start Frontend
echo -e "${GREEN}Starting Angular Frontend (Port 4200)...${NC}"
cd frontend
npm run start &
FRONTEND_PID=$!
cd ..

# 5. Start Prisma Studio
echo -e "${GREEN}Starting Prisma Studio (Port 5555)...${NC}"
cd backend
npx prisma studio --port 5555 &
PRISMA_PID=$!
cd ..

echo -e "\n${BLUE}======================================================${NC}"
echo -e "${GREEN}✔ All services are booting up!${NC}"
echo -e "Frontend UI: http://localhost:4200"
echo -e "Backend API: http://localhost:3000"
echo -e "Prisma Studio: http://localhost:5555"
echo -e "${BLUE}Press Ctrl+C to stop all servers gracefully.${NC}"
echo -e "${BLUE}======================================================${NC}\n"

# Wait for both processes and trap Ctrl+C to kill them
trap "echo -e '\n${RED}Stopping servers...${NC}'; kill $BACKEND_PID $FRONTEND_PID $PRISMA_PID; exit 1" INT
wait
