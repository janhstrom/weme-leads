import assert from 'node:assert/strict';
import test from 'node:test';

import { chartRows, type ImportedChartModel } from './ImportedChart';

function percentChart(
  categories: string[],
  values: Array<Array<number | null>>,
): ImportedChartModel {
  return {
    type: 'column',
    grouping: 'percentStacked',
    series: values.map((seriesValues, index) => ({
      name: `Series ${index + 1}`,
      categories,
      values: seriesValues,
    })),
  };
}

test('keeps nullable values null while scaling percentage rows', () => {
  const rows = chartRows(
    percentChart(['Mixed'], [
      [25],
      [null],
      [75],
    ]),
  );

  assert.deepEqual(rows, [
    {
      category: 'Mixed',
      'series-0': 25,
      'series-1': null,
      'series-2': 75,
    },
  ]);
});

test('leaves an all-null percentage row null instead of creating values', () => {
  const rows = chartRows(
    percentChart(['No data'], [
      [null],
      [null],
    ]),
  );

  assert.deepEqual(rows, [
    {
      category: 'No data',
      'series-0': null,
      'series-1': null,
    },
  ]);
});

test('scales positive percentage rows to a total of 100', () => {
  const rows = chartRows(
    percentChart(['Pipeline'], [
      [10],
      [20],
      [70],
    ]),
  );

  const values = Object.entries(rows[0] ?? {})
    .filter(([key]) => key.startsWith('series-'))
    .map(([, value]) => value);

  assert.deepEqual(values, [10, 20, 70]);
  assert.equal(
    values.reduce<number>(
      (total, value) => total + (typeof value === 'number' ? value : 0),
      0,
    ),
    100,
  );
});