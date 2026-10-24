import type { DB } from "./db";
import type { Profile } from "./types";

type SeedUser = {
  id: string;
  name: string;
  age: number;
  city: string;
  pronouns: string;
  tagline: string;
  hue: number;
  profile: Profile;
  facts: string[];
  private: string[];
};

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);
const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

// The hackathon sits three weeks out from whenever the database is seeded, so the demo never goes stale.
function hackathon() {
  const start = daysFromNow(21);
  const end = new Date(start.getTime() + 2 * 86400000);
  return `the Golden Gate Hardware Hackathon (${fmtDay(start)}-${fmtDay(end)}, at Fort Mason)`;
}

export function seedUsers(): SeedUser[] {
  const hack = hackathon();
  return [
    {
      id: "u_maya",
      name: "Maya Okafor",
      age: 24,
      city: "Oakland",
      pronouns: "she/her",
      tagline: "Backend engineer who misses making things you can touch",
      hue: 258,
      profile: {
        about:
          "Backend engineer at a payments startup. Grew up in Houston, studied EECS at Berkeley, stayed in the Bay. Cooks jollof for anyone who shows up, reads a lot of sci-fi, and climbs twice a week when work allows.",
        interests: ["bouldering", "sci-fi novels", "West African cooking", "robotics", "Arduino", "long walks with podcasts"],
        values: ["curiosity", "showing up for people", "building over talking"],
        lookingFor: "People to build weird things with, and friends who'll drag me out of my apartment on weekends.",
        recent: [
          "Bought a 6-DOF robot arm kit last month and has been teaching herself ROS 2 at night",
          `Registered solo for ${hack}; doesn't have a team yet`,
        ],
        vibe: "warm, dry humor, a little introverted until she's comfortable",
      },
      facts: [
        "Was in the Cal robotics club freshman and sophomore year before switching her focus to software",
        "Her robot arm currently can pick up exactly one (1) gummy bear",
        "Climbs at Touchstone Oakland on Tuesday and Thursday evenings",
      ],
      private: ["Has felt a bit isolated since moving to Oakland and most college friends scattering", "Is nervous about showing up to a hackathon alone"],
    },
    {
      id: "u_theo",
      name: "Theo Park",
      age: 25,
      city: "San Francisco",
      pronouns: "he/him",
      tagline: "Mechanical engineer, board-game hoarder, printer of small plastic legs",
      hue: 200,
      profile: {
        about:
          "Mechanical engineer doing enclosure design for a consumer hardware company. Bikes everywhere, hosts a monthly board-game night, and has a spare room that is now mostly a 3D-print farm.",
        interests: ["3D printing", "cycling", "board games", "mechanical keyboards", "hexapod robots", "vegetarian cooking"],
        values: ["craftsmanship", "loyalty", "learning in public"],
        lookingFor: "A build buddy who's stronger on software than me, and more reasons to leave my workshop.",
        recent: [
          "Printed and assembled an 18-servo hexapod; the gait code is the part he's stuck on",
          `Planning to go to ${hack} and is looking for a teammate who can handle motion planning`,
        ],
        vibe: "earnest, goofy, gets excited fast",
      },
      facts: [
        "Was in the Cal robotics club, where he and Maya built a line-follower that famously drove off a table",
        "Keeps meaning to text old friends from college but gets absorbed in projects",
      ],
      private: ["Assumed Maya had lost interest in hardware once she took a software job"],
    },
    {
      id: "u_priya",
      name: "Priya Raman",
      age: 27,
      city: "Berkeley",
      pronouns: "she/her",
      tagline: "Product designer by day, ceramicist by night",
      hue: 330,
      profile: {
        about:
          "Product designer at a health-tech company. Throws pottery at a community studio, boulders, and is slowly turning her balcony into a succulent jungle.",
        interests: ["ceramics", "bouldering", "product design", "succulents", "zines", "Tamil film"],
        values: ["patience", "making things beautiful", "honesty"],
        lookingFor: "A consistent climbing partner and people who like making things with their hands.",
        recent: ["Just started projecting V5s and wants someone to work routes with", "Sold her first set of mugs at a craft fair"],
        vibe: "calm, observant, quietly funny",
      },
      facts: ["Climbs at Touchstone Berkeley, usually weekday evenings"],
      private: ["Recently went through a breakup and is rebuilding her social circle"],
    },
    {
      id: "u_marcus",
      name: "Marcus Bell",
      age: 31,
      city: "Oakland",
      pronouns: "he/him",
      tagline: "Jazz pianist who bakes too much bread",
      hue: 28,
      profile: {
        about:
          "Music teacher at a middle school and a working jazz pianist on weekends. Volunteers at a community radio station and keeps a sourdough starter named Thelonious.",
        interests: ["jazz piano", "sourdough", "community radio", "vinyl", "Oakland history", "basketball"],
        values: ["community", "generosity", "practice"],
        lookingFor: "Musicians to jam with and neighbors who want to start a supper club.",
        recent: ["Hosting a Sunday-afternoon jam at a café in Temescal", "Wants to start a neighborhood bread swap"],
        vibe: "easygoing, storyteller, big laugh",
      },
      facts: ["Plays a Rhodes at most gigs"],
      private: [],
    },
    {
      id: "u_lena",
      name: "Lena Fischer",
      age: 26,
      city: "San Francisco",
      pronouns: "she/her",
      tagline: "Marathoner, book-club host, chronic urban sketcher",
      hue: 160,
      profile: {
        about:
          "Data analyst at a transit nonprofit. Runs a monthly sci-fi book club, trains for marathons, and sketches buildings on her lunch break.",
        interests: ["marathons", "sci-fi book club", "urban sketching", "public transit", "German baking"],
        values: ["discipline", "inclusivity", "curiosity"],
        lookingFor: "More regulars for book club and a running group for long Saturday runs.",
        recent: ["Book club is reading 'The Dispossessed' this month", "Training for the CIM marathon in December"],
        vibe: "organized, bright, a natural host",
      },
      facts: ["Met Maya at a sci-fi reading two years ago"],
      private: [],
    },
    {
      id: "u_sam",
      name: "Sam Rivera",
      age: 23,
      city: "San Jose",
      pronouns: "they/them",
      tagline: "Indie game dev, synthwave producer, game-jam regular",
      hue: 290,
      profile: {
        about:
          "Gameplay programmer at a mid-size studio. Makes synthwave on the side and has done 14 game jams. Strong opinions about pixel art.",
        interests: ["game jams", "synthwave", "pixel art", "Godot", "speedrunning", "skateboarding"],
        values: ["play", "shipping small things", "kindness online"],
        lookingFor: "Jam teammates (especially artists and musicians) and people to skate with.",
        recent: ["Entering the Global Game Jam in January", "Releasing a 4-track synthwave EP"],
        vibe: "chatty, chaotic-good, very online",
      },
      facts: ["Mostly does software-only hackathons and game jams; has never touched hardware"],
      private: [],
    },
    {
      id: "u_rosa",
      name: "Rosa Delgado",
      age: 29,
      city: "Oakland",
      pronouns: "she/her",
      tagline: "Community gardener, salsa dancer, feeds everyone",
      hue: 8,
      profile: {
        about:
          "Nurse at Highland Hospital. Runs a plot at a community garden, dances salsa on Fridays, and volunteers at the food bank once a month.",
        interests: ["community gardening", "salsa dancing", "cooking for crowds", "food bank volunteering", "telenovelas"],
        values: ["care", "joy", "community"],
        lookingFor: "Friends to cook big meals with, and people who'll come to salsa night.",
        recent: ["Growing peppers and tomatillos for a fall salsa-making party", "Organizing a potluck at the garden next month"],
        vibe: "warm, direct, the friend who remembers your birthday",
      },
      facts: ["Her garden is in West Oakland"],
      private: ["Works night shifts, so weekday evenings are hard"],
    },
    {
      id: "u_aiden",
      name: "Aiden Cho",
      age: 28,
      city: "San Francisco",
      pronouns: "he/him",
      tagline: "Film photographer and weekend backpacker",
      hue: 120,
      profile: {
        about:
          "UX researcher. Shoots medium-format film, backpacks in the Sierra most summer weekends, and is learning to identify birds by call.",
        interests: ["film photography", "backpacking", "birding", "darkroom printing", "coffee"],
        values: ["presence", "slowness", "attention to detail"],
        lookingFor: "Hiking partners and people to share a darkroom with.",
        recent: ["Building a home darkroom in his garage", "Planning a fall-colors trip to the Eastern Sierra"],
        vibe: "quiet, thoughtful, dry wit",
      },
      facts: [],
      private: [],
    },
  ];
}

export function seedFriendships() {
  const ago = (d: number) => daysFromNow(-d).toISOString();
  return [
    { a: "u_maya", b: "u_theo", context: "College friends from the Cal robotics club", lastSpoke: ago(186) },
    { a: "u_maya", b: "u_lena", context: "Met at a sci-fi reading; Maya drops into Lena's book club", lastSpoke: ago(12) },
    { a: "u_theo", b: "u_sam", context: "Met at a San Jose hackathon two years ago", lastSpoke: ago(240) },
    { a: "u_lena", b: "u_aiden", context: "Former coworkers", lastSpoke: ago(30) },
    { a: "u_marcus", b: "u_rosa", context: "Neighbors in Oakland", lastSpoke: ago(5) },
  ];
}

export function seedDatabase(conn: DB) {
  const ts = new Date().toISOString();
  const insUser = conn.prepare(
    "INSERT INTO users (id, name, first_name, age, city, pronouns, tagline, hue, profile, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  const insMem = conn.prepare("INSERT INTO memories (user_id, kind, text, source, created_at) VALUES (?,?,?,?,?)");
  const insFriend = conn.prepare("INSERT INTO friendships (a, b, context, last_spoke) VALUES (?,?,?,?)");
  conn.exec("BEGIN");
  try {
    for (const u of seedUsers()) {
      insUser.run(u.id, u.name, u.name.split(" ")[0], u.age, u.city, u.pronouns, u.tagline, u.hue, JSON.stringify(u.profile), ts);
      for (const f of u.facts) insMem.run(u.id, "fact", f, "seed", ts);
      for (const p of u.private) insMem.run(u.id, "private", p, "seed", ts);
    }
    for (const f of seedFriendships()) insFriend.run(f.a, f.b, f.context, f.lastSpoke);
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}
