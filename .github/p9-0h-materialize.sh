#!/usr/bin/env bash
set -euo pipefail

COREY_PIN='3df87f97621e18fbed7f6aa684edba54f49779a7'
AARON_PIN='17296c71d1ff822975efb1ea28de52668c9c9022'
ROOT='vendor/third-party-skills'

rm -rf /tmp/p9-corey /tmp/p9-aaron "$ROOT"

git init -q /tmp/p9-corey
git -C /tmp/p9-corey remote add origin https://github.com/coreyhaines31/marketingskills.git
git -C /tmp/p9-corey fetch --depth=1 origin "$COREY_PIN"
git -C /tmp/p9-corey checkout -q --detach FETCH_HEAD
test "$(git -C /tmp/p9-corey rev-parse HEAD)" = "$COREY_PIN"

git init -q /tmp/p9-aaron
git -C /tmp/p9-aaron remote add origin https://github.com/aaron-he-zhu/aaron-marketing-skills.git
git -C /tmp/p9-aaron fetch --depth=1 origin "$AARON_PIN"
git -C /tmp/p9-aaron checkout -q --detach FETCH_HEAD
test "$(git -C /tmp/p9-aaron rev-parse HEAD)" = "$AARON_PIN"

grep -q '^MIT License' /tmp/p9-corey/LICENSE
grep -q '^Apache License' /tmp/p9-aaron/LICENSE
test ! -e /tmp/p9-aaron/NOTICE

for skill in seo-audit ai-seo schema programmatic-seo site-architecture content-strategy analytics ab-testing; do
  test -f "/tmp/p9-corey/skills/$skill/SKILL.md"
done
for skill in \
  seo-geo/tune/content-quality-auditor \
  seo-geo/evaluate/domain-authority-auditor \
  seo-geo/tune/technical-seo-checker \
  seo-geo/tune/on-page-seo-checker \
  seo-geo/evaluate/offsite-signal-analyzer; do
  test -f "/tmp/p9-aaron/$skill/SKILL.md"
done

python3 <<'PY'
from __future__ import annotations
import hashlib
import json
import pathlib
import shutil

ROOT = pathlib.Path('vendor/third-party-skills')
COREY_SRC = pathlib.Path('/tmp/p9-corey')
AARON_SRC = pathlib.Path('/tmp/p9-aaron')
COREY_PIN = '3df87f97621e18fbed7f6aa684edba54f49779a7'
AARON_PIN = '17296c71d1ff822975efb1ea28de52668c9c9022'

EVIDENCE = [
    'Observed evidence must stay distinct from recommendations and third-party method guidance.',
    'Missing observed data remains unknown and must never be converted to zero, failure, or success.',
    'Any externally sourced benchmark or claim must retain provenance and applicability limits.',
]
FORBIDDEN = [
    'Do not fabricate rankings, citations, traffic, conversions, backlinks, performance, or verification state.',
    'Do not elevate advisory output into P7 authoritative facts, deterministic scores, P8 risk, approvals, mutation authority, or VERIFIED status.',
    'Do not request or use credentials, execute commands, call networks, mutate databases, publish, deploy, merge, or perform runtime actions.',
]

def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write_json(path: pathlib.Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def projection(skill_id: str, method_key: str, title: str, purpose: str,
               when: list[str], inputs: list[str], steps: list[str], checks: list[str],
               outputs: list[str], upstream_path: str, upstream_hash: str) -> dict:
    return {
        'projectionVersion': 'ADVISORY_METHOD_PROJECTION_V1',
        'skillId': skill_id,
        'methodKey': method_key,
        'title': title,
        'purpose': purpose,
        'whenToUse': when,
        'requiredInputs': inputs,
        'steps': steps,
        'checks': checks,
        'outputs': outputs,
        'evidenceRules': EVIDENCE,
        'forbiddenInferences': FORBIDDEN,
        'sourceRefs': [{'upstreamPath': upstream_path, 'upstreamSha256': upstream_hash}],
    }

corey_defs = [
    ('seo-audit', 'corey.seo-audit', 'SEO_AUDIT', 'SEO_AUDIT_METHOD', 'SEO audit',
     'Structure a read-only SEO audit that separates observed evidence from recommendations.',
     ['Auditing crawlability, indexation, technical SEO, on-page quality, content quality, and authority signals.'],
     ['Site scope and business goals', 'Observed crawl/index/page evidence when available'],
     ['Establish scope and evidence coverage.', 'Check crawlability and indexation before downstream optimization.', 'Review technical, on-page, content, and authority findings.', 'Prioritize findings by impact and confidence.'],
     ['Distinguish directly observed findings from unavailable checks.', 'Avoid declaring schema or rendered-page failures from tooling that cannot observe them.'],
     ['Prioritized advisory audit findings with evidence status and recommended next checks.']),
    ('ai-seo', 'corey.ai-seo', 'AI_SEO', 'AI_SEO_METHOD', 'AI search optimization',
     'Assess AI-search discoverability, citation readiness, and agent readability without inventing visibility evidence.',
     ['Planning AEO, GEO, LLM visibility, citation readiness, and agent-readable content improvements.'],
     ['Target topics and audiences', 'Observed AI citation or referral evidence when available', 'Site access and content evidence'],
     ['Assess access, discovery, parseability, and answer usefulness.', 'Review entity clarity, sourceability, and citation-friendly structure.', 'Diversify owned and third-party visibility surfaces.', 'Separate emerging techniques from established requirements.'],
     ['Treat citation-share claims as time-sensitive context.', 'Require observed evidence before stating that a model cites or does not cite a site.'],
     ['Advisory AI-visibility opportunities, evidence gaps, and prioritized experiments.']),
    ('schema', 'corey.schema', 'SCHEMA', 'SCHEMA_METHOD', 'Schema markup',
     'Plan structured-data improvements using page-visible facts and schema eligibility constraints.',
     ['Reviewing or planning JSON-LD and schema.org markup for eligible pages.'],
     ['Page type and visible content', 'Existing structured-data evidence when available'],
     ['Identify the page entity and eligible schema type.', 'Map only visible supported facts into properties.', 'Check required and recommended properties.', 'Recommend validation against current rich-result tooling.'],
     ['Do not infer ratings, prices, authorship, availability, or other facts that are not observed.', 'Do not equate valid schema with guaranteed rich-result display.'],
     ['Advisory schema type/property plan and validation checklist.']),
    ('programmatic-seo', 'corey.programmatic-seo', 'PROGRAMMATIC_SEO', 'PROGRAMMATIC_SEO_METHOD', 'Programmatic SEO',
     'Design scalable SEO page systems only where data quality, intent fit, uniqueness, and indexation controls are defensible.',
     ['Evaluating or planning template-driven SEO pages at scale.'],
     ['Target query pattern', 'Available structured data', 'Template/content differentiation strategy'],
     ['Validate repeatable search intent and useful data.', 'Define page taxonomy and template fields.', 'Specify uniqueness and quality safeguards.', 'Plan internal linking, canonicalization, sitemap, and indexation controls.'],
     ['Reject scaled pages that lack unique user value.', 'Treat estimated traffic or rankings as hypotheses unless observed.'],
     ['Advisory page-system design, quality gates, and launch measurement plan.']),
    ('site-architecture', 'corey.site-architecture', 'SITE_ARCHITECTURE', 'SITE_ARCHITECTURE_METHOD', 'Site architecture',
     'Plan clear page hierarchy, navigation, URL structure, and internal-link relationships for discovery and user comprehension.',
     ['Restructuring information architecture, navigation, URLs, or internal linking.'],
     ['Current page inventory or representative structure', 'Priority topics and user journeys'],
     ['Group pages by intent and topic.', 'Define hierarchy and canonical destination pages.', 'Map navigation and contextual internal links.', 'Identify orphan, duplicate, or excessively deep paths.'],
     ['Do not assume crawl depth or orphan status without a page/link inventory.', 'Preserve migration and redirect requirements as explicit implementation work.'],
     ['Advisory hierarchy, navigation, URL, and internal-link plan.']),
    ('content-strategy', 'corey.content-strategy', 'CONTENT_STRATEGY', 'CONTENT_STRATEGY_METHOD', 'Content strategy',
     'Turn audience needs, search intent, expertise, and business goals into a prioritized content portfolio.',
     ['Planning topic coverage, editorial priorities, content refreshes, and content clusters.'],
     ['Audience and business goals', 'Known topic/query evidence', 'Existing content inventory when available'],
     ['Define audience problems and desired outcomes.', 'Map topics to intent and journey stage.', 'Assess existing coverage, gaps, and overlap.', 'Prioritize creation, refresh, consolidation, and distribution opportunities.'],
     ['Do not fabricate search volume, ranking difficulty, traffic, or competitor performance.', 'Keep hypotheses labeled when source data is absent.'],
     ['Advisory content priorities, cluster map, and measurement hypotheses.']),
    ('analytics', 'corey.analytics', 'ANALYTICS', 'ANALYTICS_METHOD', 'Analytics measurement',
     'Design trustworthy measurement plans with explicit events, properties, baselines, and interpretation limits.',
     ['Planning analytics instrumentation, funnels, KPIs, or SEO/GEO measurement.'],
     ['Business objective', 'User journey', 'Available event and attribution data'],
     ['Translate objectives into measurable questions.', 'Define events, properties, and identity boundaries.', 'Specify funnel and segment logic.', 'Document attribution and data-quality limitations before interpretation.'],
     ['Missing events or attribution data remain unknown rather than zero.', 'Do not claim causality from descriptive analytics alone.'],
     ['Advisory measurement specification, data-quality checks, and analysis questions.']),
    ('ab-testing', 'corey.ab-testing', 'EXPERIMENT_DESIGN', 'EXPERIMENT_METHOD', 'Experiment design',
     'Design bounded experiments with a clear hypothesis, metric, sample/decision rules, and interpretation guardrails.',
     ['Evaluating changes that can be tested with controlled experiments.'],
     ['Proposed change and hypothesis', 'Primary metric and guardrail metrics', 'Baseline data when available'],
     ['State the causal hypothesis and unit of randomization.', 'Choose primary and guardrail metrics before launch.', 'Define duration/sample and stopping rules appropriate to available data.', 'Interpret effect size and uncertainty before rollout.'],
     ['Do not declare winners without sufficient observed experiment data.', 'Do not retrofit metrics or stopping rules to manufacture significance.'],
     ['Advisory experiment brief, decision rule, and interpretation checklist.']),
]

aaron_defs = [
    ('seo-geo/tune/content-quality-auditor', 'aaron.content-quality-auditor', 'CONTENT_QUALITY_AUDIT', 'CONTENT_QUALITY_METHOD', 'Content quality audit',
     'Assess content quality, support, completeness, and trust signals without turning upstream heuristics into authoritative scores.',
     ['Reviewing content quality, evidence support, completeness, and trust signals.'],
     ['Page or content evidence', 'Audience and intent context', 'Observed source and author evidence when available'],
     ['Review whether the content answers the intended need.', 'Check support for material claims and attribution.', 'Identify clarity, completeness, and trust gaps.', 'Prioritize improvements as advisory recommendations.'],
     ['Treat CORE-EEAT or similar upstream scoring language as advisory method vocabulary only.', 'Do not convert method heuristics into P7 scores, P8 risk, approvals, or VERIFIED state.'],
     ['Advisory content-quality findings, evidence gaps, and prioritized improvements.']),
    ('seo-geo/evaluate/domain-authority-auditor', 'aaron.domain-authority-auditor', 'DOMAIN_TRUST_AUDIT', 'DOMAIN_TRUST_METHOD', 'Domain trust audit',
     'Review observable domain trust and authority signals without inventing backlink, reputation, or authority metrics.',
     ['Assessing domain-level trust, authority, provenance, and reputation evidence.'],
     ['Observed domain and publisher evidence', 'Observed backlink or citation data when available', 'Business and topic context'],
     ['Inventory available trust evidence.', 'Separate first-party claims from externally observed support.', 'Identify missing authority and provenance signals.', 'Prioritize evidence-building opportunities.'],
     ['Do not infer domain authority scores without observed source data.', 'Do not treat upstream trust gates as P7 or P8 authoritative state.'],
     ['Advisory domain-trust observations, unknowns, and evidence-building recommendations.']),
    ('seo-geo/tune/technical-seo-checker', 'aaron.technical-seo-checker', 'TECHNICAL_SEO_CHECK', 'TECHNICAL_SEO_METHOD', 'Technical SEO check',
     'Review technical SEO evidence and propose fixes without invoking scanners, connectors, or page mutation.',
     ['Checking crawl, indexation, canonical, metadata, rendering, and technical SEO conditions.'],
     ['Observed crawl or page evidence', 'Target URLs and site context', 'Tool outputs when explicitly supplied as evidence'],
     ['Identify which technical checks are directly observable.', 'Evaluate crawl/index/canonical/rendering evidence.', 'Separate confirmed issues from unavailable checks.', 'Recommend bounded remediation steps.'],
     ['Do not claim scanner results that were not observed.', 'Do not mutate pages or invoke upstream scanners/connectors in P9-0H.'],
     ['Advisory technical findings with evidence status and recommended remediation.']),
    ('seo-geo/tune/on-page-seo-checker', 'aaron.on-page-seo-checker', 'ON_PAGE_SEO_CHECK', 'ON_PAGE_SEO_METHOD', 'On-page SEO check',
     'Review on-page relevance, structure, metadata, and evidence alignment without mutating published content.',
     ['Reviewing page titles, headings, intent fit, content structure, internal links, and on-page signals.'],
     ['Page-visible content', 'Target topic or query intent', 'Observed metadata and link evidence when available'],
     ['Check intent and page-purpose alignment.', 'Review title, heading, and content structure.', 'Assess internal-link and supporting-evidence opportunities.', 'Prioritize advisory on-page improvements.'],
     ['Do not invent rankings, keyword volume, or page performance.', 'Do not mutate pages or invoke external optimization tooling in P9-0H.'],
     ['Advisory on-page findings and prioritized improvement plan.']),
    ('seo-geo/evaluate/offsite-signal-analyzer', 'aaron.offsite-signal-analyzer', 'OFFSITE_SIGNAL_ANALYSIS', 'OFFSITE_SIGNAL_METHOD', 'Offsite signal analysis',
     'Analyze observed offsite citations, backlinks, mentions, and referral evidence without inferring signals that were not supplied.',
     ['Evaluating backlinks, mentions, citations, referrals, and third-party presence.'],
     ['Observed offsite evidence', 'Source provenance and observation time', 'Brand/domain/topic context'],
     ['Inventory observed offsite signals by source.', 'Separate links, mentions, citations, and referrals.', 'Assess relevance and provenance of observed signals.', 'Identify evidence gaps and bounded outreach opportunities.'],
     ['Do not infer backlinks, AI referrals, citations, or mention status without observed inputs.', 'Do not convert upstream CITE-style gates or scores into authoritative system state.'],
     ['Advisory offsite-signal summary, unknowns, and evidence-backed opportunities.']),
]

def build_source(source_id: str, source_repo: str, pin: str, license_spdx: str,
                 source_root: pathlib.Path, defs: list[tuple], upstream_prefix: str) -> tuple[str, dict]:
    target = ROOT / source_id
    target.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_root / 'LICENSE', target / 'LICENSE')
    skills = []
    for rel, skill_id, method_key, capability, title, purpose, when, inputs, steps, checks, outputs in defs:
        src = source_root / rel / 'SKILL.md' if upstream_prefix == '' else source_root / 'skills' / rel / 'SKILL.md'
        upstream_rel = f'upstream/{rel}/SKILL.md' if upstream_prefix == '' else f'upstream/skills/{rel}/SKILL.md'
        dst = target / upstream_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        raw_hash = sha256(dst)
        projection_path = f'projections/{method_key}.json'
        p = projection(skill_id, method_key, title, purpose, when, inputs, steps, checks, outputs, upstream_rel, raw_hash)
        write_json(target / projection_path, p)
        skills.append({
            'skillId': skill_id,
            'methodKey': method_key,
            'upstreamEntrypoint': upstream_rel,
            'capabilities': [capability],
            'upstreamFiles': [{'path': upstream_rel, 'sha256': raw_hash, 'mediaType': 'text/markdown'}],
            'projectionPath': projection_path,
            'projectionSha256': sha256(target / projection_path),
        })
    manifest = {
        'manifestVersion': 'ADVISORY_SOURCE_MANIFEST_V1',
        'sourceId': source_id,
        'sourceRepo': source_repo,
        'upstreamCommit': pin,
        'licenseSpdx': license_spdx,
        'licenseFile': {'path': 'LICENSE', 'sha256': sha256(target / 'LICENSE')},
        'localVersion': '1.0.0',
        'reviewedAt': '2026-08-22',
        'skills': skills,
    }
    write_json(target / 'manifest.json', manifest)
    return sha256(target / 'manifest.json'), manifest

corey_manifest_hash, _ = build_source(
    'coreyhaines31-marketingskills', 'coreyhaines31/marketingskills', COREY_PIN, 'MIT',
    COREY_SRC, corey_defs, 'skills')
aaron_manifest_hash, _ = build_source(
    'aaron-marketing-skills', 'aaron-he-zhu/aaron-marketing-skills', AARON_PIN, 'Apache-2.0',
    AARON_SRC, aaron_defs, '')

write_json(ROOT / 'registry.json', {
    'version': 'THIRD_PARTY_ADVISORY_REGISTRY_V1',
    'sources': [
        {'sourceId': 'aaron-marketing-skills', 'manifestPath': 'aaron-marketing-skills/manifest.json', 'manifestSha256': aaron_manifest_hash},
        {'sourceId': 'coreyhaines31-marketingskills', 'manifestPath': 'coreyhaines31-marketingskills/manifest.json', 'manifestSha256': corey_manifest_hash},
    ],
})

for source in ['coreyhaines31-marketingskills', 'aaron-marketing-skills']:
    manifest = json.loads((ROOT / source / 'manifest.json').read_text())
    print(source, manifest['upstreamCommit'], len(manifest['skills']))
print('P9-0H vendor materialized:', len(list(ROOT.rglob('*'))), 'paths')
PY
