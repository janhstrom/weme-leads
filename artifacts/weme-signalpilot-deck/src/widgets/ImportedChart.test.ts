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

test('keeps zero-only percentage categories at zero while normalizing non-zero categories', () => {
  const rows = chartRows(
    percentChart(
      ['No activity', 'Pipeline'],
      [
        [0, 10],
        [0, 20],
      ],
    ),
  );

  assert.deepEqual(rows[0], {
    category: 'No activity',
    'series-0': 0,
    'series-1': 0,
  });

  const zeroValues = Object.entries(rows[0] ?? {})
    .filter(([key]) => key.startsWith('series-'))
    .map(([, value]) => value);
  assert.deepEqual(zeroValues, [0, 0]);

  const nonZeroValues = Object.entries(rows[1] ?? {})
    .filter(([key]) => key.startsWith('series-'))
    .map(([, value]) => value);
  assert.ok(Math.abs(Number(nonZeroValues[0]) - 100 / 3) < Number.EPSILON);
  assert.ok(Math.abs(Number(nonZeroValues[1]) - 200 / 3) < Number.EPSILON);
  assert.equal(
    nonZeroValues.reduce<number>(
      (total, value) =>
        total + (typeof value === 'number' ? Math.abs(value) : 0),
      0,
    ),
    100,
  );
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

test('scales mixed percentage rows by absolute total while preserving negatives', () => {
  const rows = chartRows(
    percentChart(['Net change'], [
      [30],
      [-10],
    ]),
  );

  const values = Object.entries(rows[0] ?? {})
    .filter(([key]) => key.startsWith('series-'))
    .map(([, value]) => value);

  // The percentage total is based on magnitudes: 30 + |-10| = 40.
  // The signed values therefore render as 75% and -25%, whose magnitudes
  // total 100% without hiding that the second series is negative.
  assert.deepEqual(values, [75, -25]);
  assert.equal(
    values.reduce<number>(
      (total, value) =>
        total + (typeof value === 'number' ? Math.abs(value) : 0),
      0,
    ),
    100,
  );
});

test('normalizes each percentage category independently across mixed signs and nulls', () => {
  const rows = chartRows(
    percentChart(
      ['Mixed', 'Refund-heavy', 'Positive-heavy'],
      [
        [30, null, 12],
        [-10, -20, null],
        [null, 5, -3],
      ],
    ),
  );

  assert.deepEqual(rows, [
    {
      category: 'Mixed',
      'series-0': 75,
      'series-1': -25,
      'series-2': null,
    },
    {
      category: 'Refund-heavy',
      'series-0': null,
      'series-1': -80,
      'series-2': 20,
    },
    {
      category: 'Positive-heavy',
      'series-0': 80,
      'series-1': null,
      'series-2': -20,
    },
  ]);

  for (const row of rows) {
    const values = Object.entries(row)
      .filter(([key]) => key.startsWith('series-'))
      .map(([, value]) => value);

    assert.equal(
      values.reduce<number>(
        (total, value) =>
          total + (typeof value === 'number' ? Math.abs(value) : 0),
        0,
      ),
      100,
    );
  }
});
