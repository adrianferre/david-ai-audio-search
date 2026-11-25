import "server-only";

import type { NeonQueryFunction } from "@neondatabase/serverless";

import { ANY_LENGTH, type CatalogFilter, type FacetFilters, NO_FACETS } from "./types";

type Sql = NeonQueryFunction<false, false>;
type Fragment = ReturnType<Sql>;

/*
 * The facets the sidebar filters by, read from each clip's `metadata` at query
 * time: no column of their own, so a new import or a new grouping needs no
 * migration. Each is a SQL expression over the `audios` row `a`, NULL (or an
 * empty array) when the clip's dataset doesn't record it. A few thousand rows
 * make that cheap; at a much larger scale, store them as generated columns
 * and index those.
 */

/**
 * Common Voice's accents, as speakers pick or type them, lowercased, by the
 * group they count in. A speaker can give several, separated by commas; one
 * that isn't here counts in `other`, unless the speaker also gave one that is
 * ("United States English, Floridian" is `us` only).
 */
export const ACCENT_ALIASES: Record<string, readonly string[]> = {
  us: ["united states english"],
  england: ["england english"],
  "south-asia": ["india and south asia (india, pakistan, sri lanka)"],
  canada: ["canadian english"],
  australia: ["australian english"],
  ireland: ["irish english"],
  "southern-africa": ["southern african (south africa, zimbabwe, namibia)"],
  "hong-kong": ["hong kong english"],
  "new-zealand": ["new zealand english"],
  philippines: ["filipino", "filipino english"],
  malaysia: ["malaysian english"],
  wales: ["welsh english"],
  "west-indies": ["west indies and bermuda (bahamas, bermuda, jamaica, trinidad)"],
  singapore: ["singaporean english"],
  scotland: ["scottish english"],
};

const aliasRows = Object.entries(ACCENT_ALIASES).flatMap(([group, aliases]) =>
  aliases.map((alias) => ({ alias, group })),
);
const ALIASES = aliasRows.map((row) => row.alias);
const ALIAS_GROUPS = aliasRows.map((row) => row.group);

/** The clip's speaker gender, `female` or `male`; NULL when not recorded (and for AudioCaps). */
export function genderOf(sql: Sql): Fragment {
  return sql`(CASE
    WHEN a.source = 'librispeech' THEN
      CASE a.metadata->'speaker'->>'sex' WHEN 'F' THEN 'female' WHEN 'M' THEN 'male' END
    WHEN a.source = 'commonvoice' THEN
      CASE a.metadata->'speaker'->>'gender'
        WHEN 'female_feminine' THEN 'female' WHEN 'female' THEN 'female'
        WHEN 'male_masculine' THEN 'male' WHEN 'male' THEN 'male'
      END
  END)`;
}

/** The Common Voice speaker's decade, as recorded; NULL elsewhere. */
export function ageOf(sql: Sql): Fragment {
  return sql`(CASE WHEN a.source = 'commonvoice' THEN nullif(a.metadata->'speaker'->>'age', '') END)`;
}

/**
 * The Common Voice speaker's accent groups; NULL when they gave none, and
 * for the other datasets. The accents are split at the commas that aren't
 * inside parentheses: "India and South Asia (India, Pakistan, Sri Lanka)" is one.
 */
export function accentsOf(sql: Sql): Fragment {
  return sql`(CASE WHEN a.source = 'commonvoice' AND nullif(trim(a.metadata->'speaker'->>'accent'), '') IS NOT NULL THEN (
    SELECT CASE WHEN count(m.accent_group) = 0 THEN ARRAY['other']
                ELSE array_agg(DISTINCT m.accent_group) FILTER (WHERE m.accent_group IS NOT NULL) END
    FROM regexp_split_to_table(a.metadata->'speaker'->>'accent', ',(?![^()]*\\))') AS t(accent)
    LEFT JOIN unnest(${ALIASES}::text[], ${ALIAS_GROUPS}::text[]) AS m(alias, accent_group)
      ON m.alias = lower(trim(t.accent))
  ) END)`;
}

/** The AudioCaps clip's AudioSet labels; NULL for the other datasets. */
export function labelsOf(sql: Sql): Fragment {
  return sql`(CASE WHEN a.source = 'audiocaps' THEN
    ARRAY(SELECT jsonb_array_elements_text(coalesce(a.metadata->'audioSetLabels', '[]'::jsonb)))
  END)`;
}

/** True when `values` is empty, or the clip's `value` is one of them. Never NULL. */
function matchesOne(sql: Sql, value: Fragment, values: readonly string[]): Fragment {
  return sql`(cardinality(${values}::text[]) = 0 OR coalesce(${value} = ANY(${values}::text[]), false))`;
}

/** True when `values` is empty, or the clip's `list` has any of them. Never NULL. */
function matchesAny(sql: Sql, list: Fragment, values: readonly string[]): Fragment {
  return sql`(cardinality(${values}::text[]) = 0 OR coalesce(${list} && ${values}::text[], false))`;
}

/** Per facet, whether the clip `a` passes that facet's filter. */
export function facetMatches(sql: Sql, facets: FacetFilters) {
  return {
    gender: matchesOne(sql, genderOf(sql), facets.gender),
    age: matchesOne(sql, ageOf(sql), facets.age),
    accent: matchesAny(sql, accentsOf(sql), facets.accent),
    label: matchesAny(sql, labelsOf(sql), facets.label),
  };
}

/**
 * Whether the clip `a` passes the sidebar's filters: its dataset, its length
 * and every facet. A condition for a WHERE clause, never NULL.
 */
export function catalogCondition(
  sql: Sql,
  { source = null, duration = ANY_LENGTH, facets = NO_FACETS }: CatalogFilter,
): Fragment {
  const { min, max } = duration;
  const matches = facetMatches(sql, facets);
  return sql`(
    (${source}::text IS NULL OR a.source = ${source})
    AND (${min}::float8 IS NULL OR a.duration_seconds >= ${min})
    AND (${max}::float8 IS NULL OR a.duration_seconds <= ${max})
    AND ${matches.gender} AND ${matches.age} AND ${matches.accent} AND ${matches.label}
  )`;
}
