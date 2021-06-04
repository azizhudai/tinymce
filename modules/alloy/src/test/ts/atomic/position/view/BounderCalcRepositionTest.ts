import { UnitTest } from '@ephox/bedrock-client';
import { assert } from 'chai';
import * as fc from 'fast-check';

import { bounds as makeBounds } from 'ephox/alloy/alien/Boxes';
import * as Bounder from 'ephox/alloy/positioning/view/Bounder';

UnitTest.test('BounderCalcRepositionTest', () => {

  const maxBounds = 2000;
  const minBounds = 0;
  const zeroableArb = fc.integer(minBounds, maxBounds);
  const bubbleArb = fc.integer(-10, 10);

  const arbTestCase = zeroableArb.chain((boundsX) =>
    zeroableArb.chain((boundsY) =>
      fc.integer(boundsX, maxBounds).chain((x) =>
        fc.integer(boundsY, maxBounds).chain((y) =>
          zeroableArb.chain((width) =>
            zeroableArb.chain((height) =>
              fc.integer(x + width, x + maxBounds).chain((boundsW) =>
                fc.integer(y + height, y + maxBounds).chain((boundsH) =>
                  bubbleArb.chain((bubbleLeft) =>
                    bubbleArb.map((bubbleTop) => ({
                      x,
                      y,
                      width,
                      height,
                      boundsX,
                      boundsY,
                      boundsW,
                      boundsH,
                      bubbleLeft,
                      bubbleTop
                    }))
                  )
                )
              )
            )
          )
        )
      )
    )
  );

  fc.assert(fc.property(arbTestCase, (input) => {
    const { boundsX, boundsY, boundsW, boundsH, bubbleLeft, bubbleTop } = input;
    const bounds = makeBounds(boundsX, boundsY, boundsW, boundsH);
    const layoutBounds = makeBounds(boundsX + bubbleLeft, boundsY + bubbleTop, boundsW - bubbleLeft, boundsH - bubbleTop);

    const { x, y, width, height } = input;
    const box = makeBounds(x, y, width, height);
    const output = Bounder.calcReposition(box, layoutBounds, bounds);

    const outputString = JSON.stringify(output);
    assert.isAtLeast(output.x, bounds.x, 'X is not inside bounds. Returned: ' + outputString);
    assert.isAtMost(output.right, bounds.right, 'X is not inside bounds. Returned: ' + outputString);
    assert.isAtLeast(output.y, bounds.y, 'Y is not inside bounds. Returned: ' + outputString);
    assert.isAtMost(output.bottom, bounds.bottom, 'Y is not inside bounds. Returned: ' + outputString);
  }));
});
