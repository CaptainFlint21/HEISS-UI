/**
 * What sex terms mean, for prompt enhance (prompt-enhance.js). A 4B model knows
 * the words but not the positions: "missionary" came back as a missionary in a
 * long dress, "spitroasting" as two men with barbecue torches, a handjob with
 * the giver and receiver swapped (evals/enhance/FINDINGS.md). So the terms an
 * idea uses are looked up here and their plain, physical meaning goes into that
 * one request's system prompt: nothing for ideas that use none, and the table can
 * grow without costing every request.
 *
 * Each entry: `match` finds the term; `means` says who is where doing what, with
 * "she" and "he" as the usual roles (the request says to use the people the idea
 * names); `tags` are the Danbooru tags for tag models. `ambiguous` terms have an
 * everyday meaning too (a cowgirl on a horse, a facial at a spa) and only count
 * when the idea is sexual anyway.
 */

const sexual = /\b(fuck\w*|sex|sexy|cock\w*|dick\w*|penis|pussy|pussies|vagina\w*|clit\w*|cum\w*|naked|nude|nudity|tits|titties|boobs|breasts?|nipples?|ass|asshole|anus|horny|porn\w*|blowjob|bj|anal|orgasm\w*|erect\w*|strap-?on|dildo|vibrator|lingerie|topless|bottomless|nsfw|explicit|slut\w*|whore|milf|futa\w*|riding (him|her|his|a)|on top of (him|her)|between (his|her) legs|spread (legs|her legs)|(wrapped around|on top of|underneath|beneath|behind|inside|facing away from|straddling) (him|her))\b/i;

export const sexTerms = [
  { match: /\bmissionary\b/i, ambiguous: true, means: "she lies on her back, legs spread and wrapped around his hips; he lies on top of her between her legs, face to face, fucking her from the front", tags: "missionary, sex, on back, spread legs, hetero" },
  { match: /\bmating press\b/i, means: "she lies on her back with her legs folded up toward her chest; he is on top, face to face, pressing down and pinning her legs back, fucking her deep from the front", tags: "mating press, sex, on back, legs up, hetero" },
  { match: /(?<!reverse[ -])\bcow ?girl\b/i, ambiguous: true, means: "she sits upright astride his hips, facing him, riding his cock; he lies on his back beneath her", tags: "cowgirl position, girl on top, straddling, sex, hetero" },
  { match: /\breverse cow ?girl\b/i, means: "she sits upright astride his hips, facing away from him toward his feet, her back and ass toward him, riding his cock; he lies on his back beneath her", tags: "reverse cowgirl position, girl on top, straddling, sex, from behind, hetero" },
  { match: /\bdoggy ?style\b/i, means: "she is on her hands and knees; he kneels behind her, fucking her from behind", tags: "doggystyle, sex from behind, all fours, sex, hetero" },
  { match: /\bdoggy\b(?! ?(style|bag|bed|door|treat|paddle))/i, ambiguous: true, means: "she is on her hands and knees; he kneels behind her, fucking her from behind", tags: "doggystyle, sex from behind, all fours, sex, hetero" },
  { match: /\bprone ?bone\b/i, means: "she lies flat on her stomach; he lies on top of her back, fucking her from behind", tags: "prone bone, sex from behind, lying on stomach, sex, hetero" },
  { match: /\bspooning\b/i, ambiguous: true, means: "both lie on their sides, his front against her back, fucking her from behind", tags: "spooning, sex from behind, lying on side, sex, hetero" },
  { match: /\bfull nelson\b/i, means: "he stands behind her, his arms hooked under her knees and his hands locked behind her neck, holding her legs up and spread while fucking her", tags: "full nelson, legs up, spread legs, sex from behind, hetero" },
  { match: /\bpiledriver\b/i, ambiguous: true, means: "she lies on her upper back with her hips raised and legs folded over toward her head; he crouches over her, fucking her downward", tags: "piledriver (sex), legs up, sex, hetero" },
  { match: /\bstanding sex\b|\bagainst the wall\b/i, ambiguous: true, means: "both standing face to face, her back against the wall, one of her legs lifted around his hip, him fucking her", tags: "standing sex, against wall, leg lift, sex, hetero" },
  { match: /\b(69|sixty-?nine)\b(?=.*\bbed\b)/i, means: "they lie head to toe, one on top of the other, each with their mouth on the other's genitals at the same time", tags: "69, fellatio, cunnilingus, oral, hetero" },
  { match: /\b(69|sixty-?nine)\b(?!.*\bbed\b)/i, ambiguous: true, means: "they lie head to toe, one on top of the other, each with their mouth on the other's genitals at the same time", tags: "69, fellatio, cunnilingus, oral, hetero" },
  { match: /\bface ?sitting\b|\bsits? on (his|her) face\b/i, means: "he lies on his back; she sits astride his face, her pussy on his mouth, her thighs around his head", tags: "facesitting, cunnilingus, sitting on face, girl on top, hetero" },
  { match: /\bblow ?jobs?\b|\bbj\b|\bsucking (his |a |the )?(cock|dick)\b|\bfellatio\b/i, means: "the giver kneels in front of the receiver, facing him, his cock in her mouth, sucking it; the cock belongs to the one receiving, usually a man standing", tags: "fellatio, oral, penis, hetero" },
  { match: /\b(giving|gives|give) (him )?head\b|\bgo(ing|es)? down on him\b/i, means: "the giver kneels in front of the receiver, facing him, his cock in her mouth, sucking it; the cock belongs to the one receiving, usually a man standing", tags: "fellatio, oral, penis, hetero" },
  { match: /\bgo(ing|es)? down on her\b/i, means: "the giver's mouth is on her pussy, licking it, head between her thighs", tags: "cunnilingus, oral, head between thighs" },
  { match: /\b(riding|rides|bouncing on) (his|a|the|that) (cock|dick)\b/i, means: "she sits astride the man lying under her, his cock inside her, moving up and down on it", tags: "girl on top, straddling, sex, hetero" },
  { match: /\b(getting|gets|got|being) (fucked|railed|pounded|banged|drilled|plowed|bred|dicked down)\b/i, means: "a man fucking her hard; unless the idea gives the position, she is bent over something in the scene with him standing behind her, fucking her from behind", tags: "sex, hetero" },
  { match: /\bdeep ?throat\w*\b/i, means: "his cock is pushed all the way down her throat, her lips at the base", tags: "deepthroat, fellatio, irrumatio, hetero" },
  { match: /\b(face ?fuck\w*|throat ?fuck\w*|skull ?fuck\w*)\b/i, means: "he holds her head and thrusts his cock into her mouth and throat", tags: "irrumatio, deepthroat, head grab, fellatio, hetero" },
  { match: /\b(cunnilingus|eating (her|pussy)|eats? (her|pussy|her pussy) out|eating her out|licking (her|pussy|her pussy))\b/i, means: "she lies back with her legs spread; he is between her thighs, facing her pussy, his mouth on it, licking it", tags: "cunnilingus, oral, head between thighs, hetero" },
  { match: /\b(rimming|rim ?job|ass ?licking|licking (his|her) ass)\b/i, means: "one licks the other's anus, face pressed between the cheeks", tags: "anilingus, ass, oral" },
  { match: /\bhand ?jobs?\b|\bjerking (him|his cock) off\b|\bstroking his (cock|dick)\b/i, means: "the giver sits close beside the receiver, her hand wrapped around the receiver's cock, stroking it; the cock belongs to the one receiving, usually a man", tags: "handjob, penis, hetero" },
  // Solo: one person, her own hands or a toy, nobody else in the picture.
  { match: /\bmasturbat\w*\b|\btouching (herself|her pussy)\b|\bplaying with (herself|her pussy)\b|\bpleasuring herself\b|\bjilling\b/i, means: "alone, no partner: she lies back with her legs apart, one hand between her legs rubbing her clit, the other on her breast", tags: "female masturbation, solo, fingering, pussy" },
  { match: /\bfinger(ing|s|ed)? (herself|her own pussy|her pussy)\b|\bfinger(ing|s)? her (wet |own )?(cunt|clit)\b/i, means: "alone, no partner: her own fingers pushed inside her own pussy, her hand between her thighs", tags: "female masturbation, fingering, solo, pussy, spread legs" },
  { match: /\bfinger(ing|ed)\b(?! (herself|her own|her pussy|her clit))|\bgets? fingered\b/i, means: "someone else's fingers pushed inside her pussy; show whose hand it is", tags: "fingering, pussy" },
  { match: /\b(rubbing|rubs|playing with|touching) (her|her own) clit\b/i, means: "her fingertips rubbing her clit in circles, her pussy lips parted", tags: "clitoral stimulation, female masturbation, solo, pussy" },
  { match: /\b(riding|rides|bouncing on|squatting on|sitting on) (a |her |the |huge |big |large )*dildo\b|\bdildo riding\b/i, means: "alone: a dildo stands upright on the surface beneath her and she squats down onto it, knees apart, the dildo inside her pussy, her own weight pushing it in", tags: "dildo riding, dildo, sex toy, squatting, solo, female masturbation" },
  { match: /\b(vibrator|magic wand|hitachi|wand vibrator|bullet vibe)\b/i, means: "a vibrator pressed against her clit by her own hand", tags: "vibrator, sex toy, female masturbation, solo" },
  { match: /\bspread(ing)? (her |open )*(pussy|pussy lips|labia)\b|\bspread pussy\b/i, means: "her own fingers holding her pussy lips open toward the camera", tags: "spread pussy, pussy, fingers, solo" },
  { match: /\bspread(ing)? (her )*(ass|asscheeks|ass cheeks|cheeks)\b|\bspread ass\b/i, means: "her own hands pulling her ass cheeks apart, showing her anus and pussy", tags: "spread ass, ass, anus, solo" },
  { match: /\bpresenting\b/i, ambiguous: true, means: "bent over with her ass raised toward the camera, her back to it, showing her pussy and ass from behind, looking back over her shoulder", tags: "presenting, ass, all fours, from behind, pussy" },
  { match: /\bpillow (humping|grinding)\b|\bhumping (a|the|her) pillow\b/i, means: "alone: she straddles a pillow and grinds her crotch against it", tags: "pillow humping, straddling, pillow, solo, female masturbation" },
  { match: /\b(grabbing|squeezing|groping|holding) (her own |her )?(tits|breasts|boobs)\b/i, ambiguous: true, means: "her own hands squeezing her own breasts", tags: "grabbing own breast, breasts, solo" },
  { match: /\b(pinching|tweaking|playing with) (her )?nipples\b|\bnipple play\b/i, means: "her own fingers pinching her nipples", tags: "nipple tweak, breasts, solo" },
  { match: /\bflashing\b/i, ambiguous: true, means: "she pulls up her top for a moment to show her bare tits, in public", tags: "flashing, exhibitionism, breasts" },
  { match: /\bupskirt\b/i, means: "seen from below, looking up under her skirt", tags: "upskirt, from below, panties" },
  { match: /\bfoot ?jobs?\b/i, means: "the giver sits facing the receiver with her legs stretched out toward him, rubbing his cock between the soles of her feet; the cock belongs to the one receiving, usually a man", tags: "footjob, feet, penis, hetero" },
  { match: /\b(tit ?fuck\w*|tit ?jobs?|titty ?fuck\w*|paizuri|boob ?jobs?)\b/i, means: "the giver kneels in front of the receiver, facing him, pressing her breasts together around his cock; the cock belongs to the one receiving, usually a man standing", tags: "paizuri, breasts, penis, hetero" },
  { match: /\bthigh ?jobs?\b/i, means: "the receiver's cock is squeezed between the giver's closed thighs; the cock belongs to the one receiving, usually a man", tags: "thigh sex, penis, hetero" },
  { match: /\bspit ?roast\w*\b/i, means: "two men use one woman at the same time from both ends: one fucks her mouth from the front while the other fucks her from behind; she is between them, usually on all fours", tags: "spitroast, 2boys, 1girl, fellatio, sex from behind, threesome, all fours" },
  { match: /\b(double penetration|\bdp\b)\b/i, ambiguous: true, means: "two cocks inside her at once, one in her pussy and one in her ass, one man under her and one behind", tags: "double penetration, 2boys, 1girl, anal, vaginal, threesome" },
  { match: /\bgang ?bang\w*\b/i, means: "one woman with several men at once, men all around her", tags: "gangbang, multiple boys, group sex, 1girl" },
  { match: /\bbukkake\b/i, means: "several men cumming on her face at once, her face covered in cum", tags: "bukkake, cum on face, facial, multiple boys" },
  { match: /\bcream ?pie\b/i, ambiguous: true, means: "cum leaking out of her pussy after he came inside her", tags: "cum in pussy, cumdrip, creampie" },
  { match: /\bfacials?\b/i, ambiguous: true, means: "cum on her face", tags: "facial, cum on face" },
  { match: /\bcum ?shot\b|\bcumming on\b/i, means: "he is cumming, spurting onto her", tags: "ejaculation, cum" },
  { match: /\bsquirt\w*\b/i, ambiguous: true, means: "fluid spraying from her pussy as she comes", tags: "female ejaculation, squirting" },
  { match: /\bahegao\b/i, means: "her orgasm face: eyes rolled up, tongue out, mouth open", tags: "ahegao, rolling eyes, tongue out, open mouth" },
  { match: /\bpegging\b/i, means: "she wears a strap-on and fucks him in the ass", tags: "pegging, strap-on, femdom, anal" },
  { match: /\b(scissoring|tribbing|tribadism)\b/i, ambiguous: true, means: "two women with their legs interlocked, pussies pressed and grinding together", tags: "tribadism, yuri, 2girls, scissoring" },
  { match: /\bglory ?hole\b/i, means: "a cock through a hole in a stall partition, the man behind it unseen", tags: "glory hole, penis, wall" },
  { match: /\bgrinding on\b|\bdry ?humping\b|\blap ?dance\b/i, ambiguous: true, means: "she straddles him and grinds her hips on his lap", tags: "straddling, grinding, lap dance" }
];

/** The entries an idea uses: an ambiguous term only when the idea is sexual anyway. */
export function sexTermsIn(text = "") {
  const idea = String(text);
  const isSexual = sexual.test(idea);
  return sexTerms.filter((term) => term.match.test(idea) && (!term.ambiguous || isSexual));
}

// Words that bring a second person (or the viewer, in POV) into the idea. Without one, an act that takes a
// partner ("girl giving a handjob") was written with her alone, and the cock ended up hers.
const anotherPerson = /\b(he|him|his|hes|he's|man|men|guy|guys|boy|boys|bf|boyfriend|husband|dude|male|daddy|stranger|partner|lover|girlfriend|gf|wife|another|other|teammate|friend|couple|two|three|four|both|they|them|futa\w*|tgirl|trans\w*|shemale|dickgirl|lesbians?|customers?|clients?|boss|teacher|coach|doctor|step\w+|bbc|pov|you|your|me|my|i|im|i'm|first person)\b/i;

/** Whether the idea uses an act that takes a man but names nobody besides her. */
export function partnerMissing(text = "") {
  return sexTermsIn(text).some((term) => /\bhetero\b/.test(term.tags)) && !anotherPerson.test(String(text));
}

/** The lines that go into the system prompt, or "" when the idea uses no such term. */
export function sexTermNotes(text = "", { tags = false } = {}) {
  const found = sexTermsIn(text);
  if (!found.length) return "";
  const name = (term) => (String(text).match(term.match)?.[0] || "").toLowerCase();
  const lines = found.map((term) => `- "${name(term)}": ${term.means}${tags ? `. Tags: ${term.tags}` : ""}.`);
  const partner = partnerMissing(text)
    ? `\nThe idea names only her, but this takes a partner: add a man to the picture, and the cock in it is his.${tags ? " Tag him (1boy, hetero)." : ""}`
    : "";
  return `What the sex terms in this idea mean (put the people the idea names in these roles, and describe the position plainly; the body parts involved are bare, with anything still worn pushed aside):\n${lines.join("\n")}${partner}`;
}
