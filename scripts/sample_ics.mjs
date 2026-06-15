// One-shot: print a sample ICS body from the generator with pinned timestamps.
import { generateIcs } from "../server/lib/icsGenerator.ts";

const ics = generateIcs({
  uid: "screv_0102030405060708@capavate.collective",
  title: "DSC screening — NovaPay seed round",
  description: "30-min pitch + Q&A\nDial in 5 min early",
  scheduledFor: 1_715_000_000, // 2024-05-06T12:53:20Z
  durationMinutes: 45,
  location: "Zoom — https://capavate.zoom.example/j/123",
  organizer: { name: "Capavate Collective" },
  status: "CONFIRMED",
  dtstamp: 1_710_000_000, // 2024-03-09T16:00:00Z
});
process.stdout.write(ics);
