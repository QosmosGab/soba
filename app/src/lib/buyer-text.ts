// Everything the desk writes to a buyer, in the buyer's language. Reps are
// bilingual; buyers often aren't, so the confirmation, the offer and the
// "can't fill it" note follow the language of the call or text.
import { fmtMoney } from "./card";

export type Lang = "en" | "es";
export const langOf = (language: string | null | undefined): Lang => (language === "es" ? "es" : "en");

export const pickupWord = (iso: string | null, lang: Lang = "en") => iso
  ? new Date(iso + "T12:00:00Z").toLocaleString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
  : (lang === "es" ? "por definir" : "to be set");

export function fillConfirmation(template: string, v: { company: string; cases: number | null; product: string; price: number | null; pickup: string; ref: number }, lang: Lang = "en") {
  const priceText = v.price != null ? fmtMoney(v.price) : (lang === "es" ? "el precio acordado" : "the agreed price");
  return template
    .replace("{company}", v.company).replace("{cases}", v.cases != null ? String(v.cases) : (lang === "es" ? "las" : "the"))
    .replace("{product}", v.product).replace("${price}", priceText).replace("{price}", priceText)
    .replace("{pickup}", v.pickup).replace("{day}", v.pickup).replace("{ref}", String(v.ref));
}

type Offer = { company: string; cases: number | null; product: string; price: number | null; pickup: string; ref: number };

export const buyerText = {
  offer: (o: Offer, lang: Lang) => lang === "es"
    ? `${o.company}: podemos hacer ${o.cases ?? ""} cajas ${o.product} a ${o.price != null ? fmtMoney(o.price) : "el precio platicado"}, recoger ${o.pickup} (ref ${o.ref}). Responda SI para confirmar o NO.`
    : `${o.company}: we can do ${o.cases ?? ""} cases ${o.product} at ${o.price != null ? fmtMoney(o.price) : "the price discussed"}, pickup ${o.pickup} (ref ${o.ref}). Reply YES to confirm or NO.`,
  missedYou: (o: Offer, lang: Lang) => lang === "es"
    ? `${o.company}: intentamos llamarle sobre la ref ${o.ref}. Podemos hacer ${o.cases ?? ""} cajas ${o.product} a ${o.price != null ? fmtMoney(o.price) : "el precio platicado"}, recoger ${o.pickup}. Responda SI para confirmar.`
    : `${o.company}: we tried to reach you about ref ${o.ref}. We can do ${o.cases ?? ""} cases ${o.product} at ${o.price != null ? fmtMoney(o.price) : "the price discussed"}, pickup ${o.pickup}. Reply YES to confirm.`,
  cannotFill: (company: string, ref: number, reason: string | null, lang: Lang) => lang === "es"
    ? `${company}: lo sentimos, no podemos surtir su pedido (ref ${ref})${reason ? `: ${reason}` : ""}. Gracias por llamar.`
    : `${company}: sorry, we can't fill your request (ref ${ref})${reason ? `: ${reason}` : ""}. Thanks for calling.`,
  callingBack: (company: string, ref: number, lang: Lang) => lang === "es"
    ? `${company} le va a llamar sobre su pedido (ref ${ref}).`
    : `${company} calling you back about your order (ref ${ref}).`,
  passedOn: (company: string, lang: Lang) => lang === "es" ? `${company}: recibido, se lo paso al equipo.` : `${company}: got it, passing that to the team.`,
};

/** A plain YES / NO in either language. "Yes but only 250" is neither: it goes back to the reps as a change. */
export const saysYes = (t: string) => /^(yes|y|yep|yeah|yup|ok|okay|confirm|confirmed|si|sí|dale|claro|va|sale)[\s.,!]*(please|gracias|thanks|thank you)?[\s.,!]*$/i.test(t.trim());
export const saysNo = (t: string) => /^(no|n|nope|pass|no thanks|no gracias)[\s.,!]*(thanks|gracias)?[\s.,!]*$/i.test(t.trim());
/** Opt-out keywords; Twilio blocks further sends on its own, we also record it. "Cancel" is an order instruction, not an opt-out. */
export const saysStop = (t: string) => /^(stop|unsubscribe|stopall|alto)$/i.test(t.trim());
