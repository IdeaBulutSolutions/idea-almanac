import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../src/adapters/repo.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample-sfdx-repo');
const inventory = scanRepo(fixture);
const byId = new Map(inventory.items.map((i) => [i.id, i]));

describe('repo adapter', () => {
  it('finds every versioned artifact in the fixture', () => {
    expect(inventory.items).toHaveLength(10);
  });

  it('parses explicit apiVersion from meta.xml files', () => {
    expect(byId.get('force-app/main/default/classes/AncientHelper.cls-meta.xml')).toMatchObject({
      type: 'ApexClass',
      apiVersion: '28.0',
      versionSource: 'explicit',
    });
    expect(byId.get('force-app/main/default/triggers/AccountTrigger.trigger-meta.xml')).toMatchObject({
      type: 'ApexTrigger',
      apiVersion: '52.0',
    });
    expect(byId.get('force-app/main/default/flows/Order_Fulfillment.flow-meta.xml')).toMatchObject({
      type: 'Flow',
      apiVersion: '61.0',
    });
    expect(byId.get('force-app/main/default/aura/legacyPanel/legacyPanel.cmp-meta.xml')).toMatchObject({
      type: 'Aura',
      apiVersion: '45.0',
    });
  });

  it('LWC without apiVersion inherits sourceApiVersion (versionSource: inherited)', () => {
    expect(byId.get('force-app/main/default/lwc/orderList/orderList.js-meta.xml')).toMatchObject({
      type: 'LWC',
      apiVersion: '55.0',
      versionSource: 'inherited',
    });
  });

  it('reports sfdx-project.json sourceApiVersion as its own line item', () => {
    expect(byId.get('sfdx-project.json')).toMatchObject({
      type: 'ProjectDefault',
      apiVersion: '55.0',
    });
  });

  it('picks up every package.xml manifest', () => {
    expect(byId.get('manifest/package.xml')).toMatchObject({ type: 'Manifest', apiVersion: '45.0' });
    expect(byId.get('manifest/deploy/package.xml')).toMatchObject({
      type: 'Manifest',
      apiVersion: '60.0',
    });
  });

  it('malformed XML yields a warning entry, never a crash', () => {
    expect(byId.has('force-app/main/default/pages/Broken.page-meta.xml')).toBe(false);
    expect(inventory.warnings).toContainEqual({
      code: 'malformed-xml',
      message: 'Could not parse XML',
      location: 'force-app/main/default/pages/Broken.page-meta.xml',
    });
  });

  it('repo mode produces no integration findings', () => {
    expect(inventory.integrations).toEqual([]);
  });
});

describe('C1 — managed/namespaced component exclusion (repo)', () => {
  it('excludes the namespaced fixture class from the inventory', () => {
    const ids = inventory.items.map((i) => i.id);
    expect(ids).not.toContain(
      'force-app/main/default/classes/MyNs__ManagedHelper.cls-meta.xml',
    );
  });

  it('emits a managed-excluded warning with the correct count', () => {
    expect(inventory.warnings).toContainEqual({
      code: 'managed-excluded',
      message: '1 managed/namespaced component excluded — upgrade these in the package, not here.',
    });
  });

  it('does not count the excluded component in the 10 included items', () => {
    expect(inventory.items).toHaveLength(10);
  });
});
