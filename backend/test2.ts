import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, key: true, createdAt: true, startDate: true },
    orderBy: { createdAt: 'asc' }
  });
  console.table(projects);
  await app.close();
}
bootstrap();
