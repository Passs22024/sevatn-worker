import * as path from 'path';

const { PrismaClient } = require(
  path.resolve(__dirname, '../../../api/node_modules/@prisma/client')
);

const prisma = new PrismaClient();

async function main() {
  const account = await prisma.bookingAccount.findFirst({
    where: { username: '8098697141' },
  });
  console.log('Account found:', account?.username, 'ID:', account?.id);

  const bookings = await prisma.bookingRequest.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      bookingCode: true,
      requestedDate: true,
      requestedDateStr: true,
      route: true,
      timeSlot: true,
      status: true,
      executionStatus: true,
      financialStatus: true,
      lastMilestone: true,
    },
  });
  console.log('Recent bookings:\n', JSON.stringify(bookings, null, 2));

  // Find booking TA-10045 specifically
  const ta10045 = await prisma.bookingRequest.findFirst({
    where: { bookingCode: 'TA-10045' },
    include: { pilgrims: true, jobs: true },
  });
  console.log('TA-10045 details:\n', JSON.stringify(ta10045, null, 2));
}

main().finally(() => prisma.$disconnect());
