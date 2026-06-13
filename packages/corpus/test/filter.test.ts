import { describe, expect, it } from 'vitest';
import { classifySection } from '../pipeline/src/filter.ts';

const section = (heading: string, breadcrumb: string[], text: string) => ({
  heading,
  breadcrumb,
  text,
});

const LONG = 'x'.repeat(120);

describe('Stage 2 filter — recall-first', () => {
  it('keeps sections in developer areas by breadcrumb', () => {
    expect(
      classifySection(
        section('Some Feature', ['Development', 'Apex'], LONG),
      ).keep,
    ).toBe(true);
    expect(
      classifySection(
        section('Changed Connect REST API Response Body', ['Industries'], LONG),
      ).keep,
    ).toBe(true);
    expect(
      classifySection(
        section('API Distortion Changes in Lightning Web Security', ['Security'], LONG),
      ).keep,
    ).toBe(true);
  });

  it('keeps sections by developer keywords in text', () => {
    for (const text of [
      'Components compiled at API version 55.0 behave differently.',
      'This SOQL query change affects all orgs.',
      'The SOAP login() endpoint is deprecated.',
      'This is a versioned behavior change for Apex.',
      'Use the Metadata API to deploy.',
    ]) {
      // Padded past the near-empty threshold — keyword matching is what's under test here.
      expect(classifySection(section('Anything', ['Anywhere'], `${text} ${LONG}`)).keep, text).toBe(true);
    }
  });

  it('never drops deprecation/retirement notices, even tiny ones', () => {
    const d = classifySection(section('Field Service Mobile', ['Field Service'], 'This feature is retired.'));
    expect(d.keep).toBe(true);
    expect(d.matchedBy).toContain('kw:retirement');
  });

  it('drops pure product announcements', () => {
    expect(
      classifySection(
        section(
          'Sell Smarter with Embedded Dashboards',
          ['Sales Cloud'],
          `Reps can now see beautiful dashboards directly on the opportunity page. ${LONG}`,
        ),
      ).keep,
    ).toBe(false);
  });

  it('drops "See Also" stubs and Release Note Changes weeklies', () => {
    expect(classifySection(section('See Also', ['Development', 'Apex'], 'Links: Apex retirement guide')).matchedBy).toEqual(['excluded:see-also']);
    expect(classifySection(section('Week of June 8, 2026', ['Release Note Changes'], `Apex SOQL REST ${LONG}`)).matchedBy).toEqual(['excluded:release-note-changelog']);
  });

  it('drops near-empty leaves outside developer areas, keeps them inside', () => {
    expect(classifySection(section('Shiny Thing', ['Marketing'], 'REST API mention.')).keep).toBe(false);
    expect(classifySection(section('New Connect in Apex Classes', ['Development'], 'These classes are new.')).keep).toBe(true);
  });
});
