import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  host: '/tmp',
  port: 5432,
  user: 'mohitsingh',
  database: 'erp_db'
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const company = await prisma.company.findFirst();
  if (!company) {
    console.error('No company found to seed assets for.');
    return;
  }

  const employees = await prisma.employee.findMany({ where: { companyId: company.id } });
  console.log(`Found company ID: ${company.id}, Employees count: ${employees.length}`);

  const sampleAssets = [
    {
      assetTag: 'AST-2026-001',
      name: 'MacBook Pro M3 Max 16"',
      category: 'LAPTOP',
      brand: 'Apple',
      model: 'MacBook Pro 16-inch M3 Max (36GB RAM, 1TB SSD)',
      serialNumber: 'C02G87X1MD6M',
      purchaseDate: new Date('2025-11-15'),
      cost: 3499.00,
      warrantyExpiry: new Date('2028-11-15'),
      status: employees.length > 0 ? 'ASSIGNED' : 'AVAILABLE',
      assignToEmployeeId: employees[0]?.id
    },
    {
      assetTag: 'AST-2026-002',
      name: 'Dell XPS 15 9530',
      category: 'LAPTOP',
      brand: 'Dell',
      model: 'XPS 15 (Core i9 13th Gen, 32GB, RTX 4060)',
      serialNumber: 'DLXPS9530X892',
      purchaseDate: new Date('2025-10-10'),
      cost: 2399.00,
      warrantyExpiry: new Date('2027-10-10'),
      status: employees.length > 1 ? 'ASSIGNED' : 'AVAILABLE',
      assignToEmployeeId: employees[1]?.id
    },
    {
      assetTag: 'AST-2026-003',
      name: 'Lenovo ThinkPad X1 Carbon Gen 11',
      category: 'LAPTOP',
      brand: 'Lenovo',
      model: 'ThinkPad X1 Carbon Gen 11 (i7-1365U, 16GB)',
      serialNumber: 'PF49X1C11099',
      purchaseDate: new Date('2025-08-20'),
      cost: 1850.00,
      warrantyExpiry: new Date('2027-08-20'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-004',
      name: 'MacBook Air 15" M2',
      category: 'LAPTOP',
      brand: 'Apple',
      model: 'MacBook Air 15-inch (16GB RAM, 512GB SSD)',
      serialNumber: 'FVFHD901Q169',
      purchaseDate: new Date('2025-09-01'),
      cost: 1499.00,
      warrantyExpiry: new Date('2027-09-01'),
      status: employees.length > 2 ? 'ASSIGNED' : 'AVAILABLE',
      assignToEmployeeId: employees[2]?.id
    },
    {
      assetTag: 'AST-2026-005',
      name: 'Asus ROG Zephyrus G16',
      category: 'LAPTOP',
      brand: 'Asus',
      model: 'ROG Zephyrus G16 (Intel Core Ultra 9, RTX 4070)',
      serialNumber: 'R8N0CV0192837',
      purchaseDate: new Date('2026-01-12'),
      cost: 2199.00,
      warrantyExpiry: new Date('2028-01-12'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-006',
      name: 'Mac Studio M2 Ultra',
      category: 'DESKTOP',
      brand: 'Apple',
      model: 'Mac Studio (24-core CPU, 60-core GPU, 64GB RAM)',
      serialNumber: 'C02STU2025XX',
      purchaseDate: new Date('2025-06-15'),
      cost: 3999.00,
      warrantyExpiry: new Date('2028-06-15'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-007',
      name: 'Apple iMac 24" M3',
      category: 'DESKTOP',
      brand: 'Apple',
      model: 'iMac 24-inch 8-core GPU (16GB, 512GB Blue)',
      serialNumber: 'C02IMC24M300',
      purchaseDate: new Date('2025-12-05'),
      cost: 1699.00,
      warrantyExpiry: new Date('2027-12-05'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-008',
      name: 'Dell Precision 7920 Tower Workstation',
      category: 'DESKTOP',
      brand: 'Dell',
      model: 'Precision 7920 (Dual Intel Xeon, 128GB RAM, RTX A6000)',
      serialNumber: 'DLP7920WS991',
      purchaseDate: new Date('2024-11-20'),
      cost: 6500.00,
      warrantyExpiry: new Date('2027-11-20'),
      status: 'IN_REPAIR'
    },
    {
      assetTag: 'AST-2026-009',
      name: 'LG UltraFine 27" 4K Ergonomic Monitor',
      category: 'MONITOR',
      brand: 'LG',
      model: '27UN880-B 27" UltraFine Ergo IPS 4K',
      serialNumber: '309NTBK89123',
      purchaseDate: new Date('2025-07-10'),
      cost: 499.00,
      warrantyExpiry: new Date('2027-07-10'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-010',
      name: 'Dell UltraSharp 34" Curved USB-C Hub Monitor',
      category: 'MONITOR',
      brand: 'Dell',
      model: 'U3423WE 34-inch WQHD Curved',
      serialNumber: 'CN-0U3423WE-771',
      purchaseDate: new Date('2025-05-18'),
      cost: 849.00,
      warrantyExpiry: new Date('2028-05-18'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-011',
      name: 'Samsung ViewFinity S9 27" 5K Monitor',
      category: 'MONITOR',
      brand: 'Samsung',
      model: 'S90PC 27" 5K Smart Display with Matte Screen',
      serialNumber: 'SM-S90PC-5K998',
      purchaseDate: new Date('2026-02-01'),
      cost: 1299.00,
      warrantyExpiry: new Date('2028-02-01'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-012',
      name: 'Logitech MX Master 3S Performance Mouse',
      category: 'PERIPHERAL',
      brand: 'Logitech',
      model: 'MX Master 3S Pale Grey',
      serialNumber: 'LZ238910029',
      purchaseDate: new Date('2025-11-20'),
      cost: 99.99,
      warrantyExpiry: new Date('2027-11-20'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-013',
      name: 'Keychron K8 Pro QMK/VIA Wireless Mechanical Keyboard',
      category: 'PERIPHERAL',
      brand: 'Keychron',
      model: 'K8 Pro Tenkeyless RGB Gateron G Pro Red',
      serialNumber: 'KC-K8PRO-8812',
      purchaseDate: new Date('2025-10-05'),
      cost: 119.99,
      warrantyExpiry: new Date('2026-10-05'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-014',
      name: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones',
      category: 'PERIPHERAL',
      brand: 'Sony',
      model: 'WH-1000XM5 Black',
      serialNumber: 'SN-XM5-9988112',
      purchaseDate: new Date('2025-12-18'),
      cost: 399.99,
      warrantyExpiry: new Date('2026-12-18'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-015',
      name: 'CalDigit TS4 Thunderbolt 4 Station Dock',
      category: 'PERIPHERAL',
      brand: 'CalDigit',
      model: 'TS4 18-Port Thunderbolt 4 Docking Station',
      serialNumber: 'CD-TS4-887192',
      purchaseDate: new Date('2025-08-14'),
      cost: 399.95,
      warrantyExpiry: new Date('2027-08-14'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-016',
      name: 'Figma Organization Enterprise License',
      category: 'SOFTWARE',
      brand: 'Figma',
      model: 'Organization Tier 1-Year Seat',
      serialNumber: 'LIC-FIGMA-ORG-2026',
      purchaseDate: new Date('2026-01-01'),
      cost: 540.00,
      warrantyExpiry: new Date('2027-01-01'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-017',
      name: 'JetBrains All Products Pack License',
      category: 'SOFTWARE',
      brand: 'JetBrains',
      model: 'Commercial All Products Subscription',
      serialNumber: 'LIC-JB-ALL-77182',
      purchaseDate: new Date('2025-09-15'),
      cost: 779.00,
      warrantyExpiry: new Date('2026-09-15'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-018',
      name: 'Adobe Creative Cloud All Apps License',
      category: 'SOFTWARE',
      brand: 'Adobe',
      model: 'Teams Enterprise Suite',
      serialNumber: 'LIC-ADOBE-CC-9901',
      purchaseDate: new Date('2025-11-01'),
      cost: 959.88,
      warrantyExpiry: new Date('2026-11-01'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-019',
      name: 'Apple iPad Pro 12.9" M2 Wi-Fi 256GB',
      category: 'MOBILE',
      brand: 'Apple',
      model: 'iPad Pro 6th Gen Space Grey',
      serialNumber: 'DLXIPAD129M2',
      purchaseDate: new Date('2025-04-10'),
      cost: 1099.00,
      warrantyExpiry: new Date('2026-04-10'),
      status: 'AVAILABLE'
    },
    {
      assetTag: 'AST-2026-020',
      name: 'Apple iPhone 15 Pro Test Device',
      category: 'MOBILE',
      brand: 'Apple',
      model: 'iPhone 15 Pro 128GB Natural Titanium',
      serialNumber: 'F17IPHONE15PRO',
      purchaseDate: new Date('2025-09-25'),
      cost: 999.00,
      warrantyExpiry: new Date('2026-09-25'),
      status: 'AVAILABLE'
    }
  ];

  for (const item of sampleAssets) {
    const { assignToEmployeeId, ...assetData } = item;
    
    const existing = await prisma.asset.findFirst({
      where: { assetTag: assetData.assetTag, companyId: company.id }
    });

    let createdAsset;
    if (!existing) {
      createdAsset = await prisma.asset.create({
        data: {
          ...assetData,
          companyId: company.id
        }
      });
      console.log(`Created asset: [${createdAsset.assetTag}] ${createdAsset.name}`);
    } else {
      createdAsset = existing;
      console.log(`Asset already exists: [${existing.assetTag}] ${existing.name}`);
    }

    if (assignToEmployeeId && createdAsset) {
      const existingAssign = await prisma.assetAssignment.findFirst({
        where: { assetId: createdAsset.id, status: 'ACTIVE' }
      });

      if (!existingAssign) {
        await prisma.assetAssignment.create({
          data: {
            companyId: company.id,
            assetId: createdAsset.id,
            employeeId: assignToEmployeeId,
            assignedDate: new Date(),
            conditionOnAssign: 'EXCELLENT',
            status: 'ACTIVE',
            notes: 'Initial company asset allocation.'
          }
        });
        console.log(`Assigned ${createdAsset.assetTag} to Employee ID ${assignToEmployeeId}`);
      }
    }
  }

  console.log('Successfully seeded 20 company assets!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
