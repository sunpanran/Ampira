import { translate } from "./i18n.mjs";

export const INSPIRATION_PRESET_ID = "ampira-inspiration-v1";
export const INSPIRATION_PRESET_VERSION = 1;

export const INSPIRATION_PRESET_CATEGORIES = Object.freeze([
  { key: "webInteraction", quota: 8 },
  { key: "brandIdentity", quota: 8 },
  { key: "typographyEditorial", quota: 6 },
  { key: "motion3d", quota: 6 },
  { key: "architectureSpace", quota: 6 },
  { key: "artIllustration", quota: 6 },
  { key: "photographyFilm", quota: 4 },
  { key: "objectsMaterials", quota: 4 },
]);

export const INSPIRATION_PRESET_SITES = Object.freeze([
  site("siteinspire", "SiteInspire", "https://www.siteinspire.com/", "webInteraction", "web-signal-01", true),
  site("awwwards", "Awwwards", "https://www.awwwards.com/", "webInteraction", "web-signal-01", true),
  site("land-book", "Land-book", "https://land-book.com/", "webInteraction", "web-signal-02", true),
  site("recent", "Recent", "https://recent.design/", "webInteraction", "web-signal-02", true),
  site("active-theory", "Active Theory", "https://activetheory.net/", "webInteraction", "web-signal-03"),
  site("locomotive", "Locomotive", "https://locomotive.ca/", "webInteraction", "web-signal-03"),
  site("resn", "Resn", "https://resn.co.nz/", "webInteraction", "web-signal-04"),
  site("studio-freight", "Studio Freight", "https://studiofreight.com/", "webInteraction", "web-signal-04"),

  site("brand-new", "Brand New", "https://www.underconsideration.com/brandnew/", "brandIdentity", "brand-form-01", true),
  site("the-brand-identity", "The Brand Identity", "https://the-brandidentity.com/", "brandIdentity", "brand-form-01", true),
  site("bpo", "BP&O", "https://bpando.org/", "brandIdentity", "brand-form-02", true),
  site("pentagram", "Pentagram", "https://www.pentagram.com/", "brandIdentity", "brand-form-02"),
  site("studio-dumbar", "Studio Dumbar", "https://studiodumbar.com/", "brandIdentity", "brand-form-03"),
  site("made-thought", "Made Thought", "https://www.madethought.com/", "brandIdentity", "brand-form-03"),
  site("koto", "Koto", "https://koto.com/", "brandIdentity", "brand-form-04"),
  site("porto-rocha", "PORTO ROCHA", "https://www.portorocha.com/", "brandIdentity", "brand-form-04"),

  site("fonts-in-use", "Fonts In Use", "https://fontsinuse.com/", "typographyEditorial", "type-rhythm-01", true),
  site("typewolf", "Typewolf", "https://www.typewolf.com/", "typographyEditorial", "type-rhythm-01", true),
  site("klim", "Klim Type Foundry", "https://klim.co.nz/", "typographyEditorial", "type-rhythm-02"),
  site("grilli-type", "Grilli Type", "https://www.grillitype.com/", "typographyEditorial", "type-rhythm-02"),
  site("dinamo", "Dinamo", "https://abcdinamo.com/", "typographyEditorial", "type-rhythm-03"),
  site("commercial-type", "Commercial Type", "https://commercialtype.com/", "typographyEditorial", "type-rhythm-03"),

  site("motionographer", "Motionographer", "https://motionographer.com/", "motion3d", "motion-field-01", true),
  site("stash", "STASH", "https://www.stashmedia.tv/", "motion3d", "motion-field-01", true),
  site("art-of-the-title", "Art of the Title", "https://www.artofthetitle.com/", "motion3d", "motion-field-02", true),
  site("manvs-machine", "ManvsMachine", "https://mvsm.com/", "motion3d", "motion-field-02"),
  site("future-deluxe", "FutureDeluxe", "https://futuredeluxe.com/", "motion3d", "motion-field-03"),
  site("six-n-five", "Six N. Five", "https://sixnfive.com/", "motion3d", "motion-field-03"),

  site("archdaily", "ArchDaily", "https://www.archdaily.com/", "architectureSpace", "space-light-01", true),
  site("divisare", "Divisare", "https://divisare.com/", "architectureSpace", "space-light-01", true),
  site("norm-architects", "Norm Architects", "https://normcph.com/", "architectureSpace", "space-light-02"),
  site("snohetta", "Snøhetta", "https://www.snohetta.com/", "architectureSpace", "space-light-02"),
  site("oma", "OMA", "https://www.oma.com/", "architectureSpace", "space-light-03"),
  site("mvrdv", "MVRDV", "https://www.mvrdv.com/", "architectureSpace", "space-light-03"),

  site("moma", "MoMA", "https://www.moma.org/", "artIllustration", "art-chroma-01"),
  site("tate", "Tate", "https://www.tate.org.uk/", "artIllustration", "art-chroma-01"),
  site("the-met", "The Met", "https://www.metmuseum.org/", "artIllustration", "art-chroma-02"),
  site("walker-art-center", "Walker Art Center", "https://walkerart.org/", "artIllustration", "art-chroma-02"),
  site("serpentine", "Serpentine", "https://www.serpentinegalleries.org/", "artIllustration", "art-chroma-03"),
  site("mudam", "Mudam Luxembourg", "https://www.mudam.com/", "artIllustration", "art-chroma-03"),

  site("magnum-photos", "Magnum Photos", "https://www.magnumphotos.com/", "photographyFilm", "photo-grain-01"),
  site("foam", "Foam", "https://www.foam.org/", "photographyFilm", "photo-grain-01"),
  site("icp", "International Center of Photography", "https://www.icp.org/", "photographyFilm", "photo-grain-02"),
  site("film-lincoln-center", "Film at Lincoln Center", "https://www.filmlinc.org/", "photographyFilm", "photo-grain-02"),

  site("formafantasma", "Formafantasma", "https://formafantasma.com/", "objectsMaterials", "material-study-01"),
  site("nendo", "nendo", "https://www.nendo.jp/en/", "objectsMaterials", "material-study-01"),
  site("barber-osgerby", "Barber Osgerby", "https://barberosgerby.com/", "objectsMaterials", "material-study-02"),
  site("industrial-facility", "Industrial Facility", "https://www.industrialfacility.co.uk/", "objectsMaterials", "material-study-02"),
]);

export function buildInspirationPreset(locale) {
  const sectionKey = "inspirationPreset";
  const section = translate(locale, "inspirationPreset.section");
  const categories = INSPIRATION_PRESET_CATEGORIES.map(({ key }) => {
    const name = translate(locale, `category.inspiration.${key}`);
    const count = INSPIRATION_PRESET_SITES.filter((item) => item.categoryKey === key).length;
    return { name, count, categoryKey: key };
  });
  const bookmarks = INSPIRATION_PRESET_SITES.map((item) => ({
    key: `preset-${item.id}`,
    bookmarkId: "",
    title: item.title,
    url: item.url,
    host: hostOf(item.url),
    section,
    sectionKey,
    category: translate(locale, `category.inspiration.${item.categoryKey}`),
    categoryKey: item.categoryKey,
    folderPath: "",
    cardType: "inspiration",
    sourceKind: "preset",
    coverAsset: `assets/presets/inspiration/${item.coverKey}.webp`,
    coverKey: item.coverKey,
    editorial: item.editorial,
    dateAdded: 0,
    feedExcluded: false,
  }));
  return {
    section: {
      name: section,
      sectionKey,
      cardType: "inspiration",
      sourceKind: "preset",
      categories,
    },
    bookmarks,
  };
}

export function applyInspirationSource(model, settings = {}, locale = "") {
  if (settings.inspirationSourceMode !== "preset") return model;
  const preset = buildInspirationPreset(locale);
  const sections = (model.sections || []).filter((section) => section.cardType !== "inspiration");
  const bookmarks = (model.bookmarks || []).filter((item) => item.cardType !== "inspiration");
  return {
    ...model,
    sections: [...sections, preset.section],
    bookmarks: [...bookmarks, ...preset.bookmarks],
    missingFolders: (model.missingFolders || []).filter((name) => (
      !model.sections?.some((section) => section.cardType === "inspiration" && section.name === name)
    )),
  };
}

function site(id, title, url, categoryKey, coverKey, editorial = false) {
  return Object.freeze({ id, title, url, categoryKey, coverKey, editorial });
}

function hostOf(value) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}
