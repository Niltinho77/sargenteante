// prisma/seed.ts
import { prisma } from "../src/lib/prisma";


function normalize(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isWeekend(d: Date) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

async function main() {
  const start = normalize(new Date());
  start.setDate(start.getDate() - 30);

  const end = normalize(new Date());
  end.setDate(end.getDate() + 180);

  const days: { date: Date; dayType: "PRETA" | "VERMELHA" }[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push({
      date: normalize(d),
      dayType: isWeekend(d) ? "VERMELHA" : "PRETA",
    });
  }

  for (const day of days) {
    await prisma.calendarDay.upsert({
      where: { date: day.date },
      update: { dayType: day.dayType },
      create: day,
    });
  }

  console.log(`✔ Calendário gerado (${days.length} dias)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
