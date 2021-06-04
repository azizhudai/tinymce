import { Adt, Arr, Fun, Num } from '@ephox/katamari';
import { SugarElement } from '@ephox/sugar';

import * as Boxes from '../../alien/Boxes';
import { Bubble } from '../layout/Bubble';
import * as Direction from '../layout/Direction';
import * as LayoutBounds from '../layout/LayoutBounds';
import { AnchorBox, AnchorElement, AnchorLayout } from '../layout/LayoutTypes';
import * as Placement from '../layout/Placement';
import { RepositionDecision } from './Reposition';
import { SpotInfo } from './SpotInfo';

export interface BounderAttemptAdt {
  fold: <T>(
    fit: (reposition: RepositionDecision) => T,
    nofit: (reposition: RepositionDecision, deltaW: number, deltaH: number) => T
  ) => T;
  match: <T>(branches: {
    fit: (reposition: RepositionDecision) => T;
    nofit: (reposition: RepositionDecision, deltaW: number, deltaH: number) => T;
  }) => T;
  log: (label: string) => void;
}

interface PositionResult {
  readonly originInBounds: boolean;
  readonly sizeInBounds: boolean;
  readonly deltaW: number;
  readonly deltaH: number;
}

const adt: {
  fit: (reposition: RepositionDecision) => BounderAttemptAdt;
  nofit: (reposition: RepositionDecision, deltaW: number, deltaH: number) => BounderAttemptAdt;
} = Adt.generate([
  { fit: [ 'reposition' ] },
  { nofit: [ 'reposition', 'deltaW', 'deltaH' ] }
]);

/**
 * This will attempt to calculate and adjust the position of the box so that is stays within the specified bounds.
 * The end result will be a new restricted box of where it can safely be placed within the bounds as per the rules below.
 *
 * Note: There are two bounds that we need to account for when repositioning the box:
 *  - `winBounds` is the absolute bounds that we should never escape from. It in most cases will be the window viewport,
 *     but sometimes might be custom.
 *  - `layoutBounds` is the restricted bounds that correlate to the layout and anchor point. It will be a smaller box
 *     within the window bounds and is used to ensure the element isn't positioned over the anchor. We can escape this bounds
 *     but only by whatever the "bubble" offset is (ie to support a "negative" bubble).
 */
const calcReposition = (box: Boxes.Bounds, layoutBounds: Boxes.Bounds, winBounds: Boxes.Bounds): Boxes.Bounds => {
  const { x: winBoundsX, y: winBoundsY, right: winBoundsRight, bottom: winBoundsBottom } = winBounds;
  const { x: layoutBoundsX, y: layoutBoundsY, right: layoutBoundsRight, bottom: layoutBoundsBottom } = layoutBounds;
  const { x, y, width, height } = box;

  // Determine the max left, top, right and bottom coordinates
  const minX = Math.max(layoutBoundsX, winBoundsX);
  const minY = Math.max(layoutBoundsY, winBoundsY);
  const maxRight = Math.min(layoutBoundsRight, winBoundsRight);
  const maxBottom = Math.min(layoutBoundsBottom, winBoundsBottom);

  // measure the maximum x and y taking into account the height and width of the element
  const maxX = Math.max(minX, maxRight - width);
  const maxY = Math.max(minY, maxBottom - height);

  // Futz with the X value to ensure that we're not off the left or right of the screen
  const restrictedX = Num.clamp(x, minX, maxX);
  // Futz with the Y value to ensure that we're not off the top or bottom of the screen
  const restrictedY = Num.clamp(y, minY, maxY);

  // Determine the new height and width based on the restricted X/Y to keep the element in bounds
  const restrictedWidth = Math.min(restrictedX + width, maxRight) - restrictedX;
  const restrictedHeight = Math.min(restrictedY + height, maxBottom) - restrictedY;

  return Boxes.bounds(restrictedX, restrictedY, restrictedWidth, restrictedHeight);
};

/**
 * This will attempt to determine if the box will fit within the specified bounds or if it needs to be repositioned.
 * It will return the following details:
 *  - if the original rect was in bounds (originInBounds & sizeInBounds). This is used to determine if we fitted
 *    without having to make adjustments.
 *  - the height and width deltas in relation to how much height/width would be visible in the original location.
 */
const determinePosition = (box: Boxes.Bounds, bounds: Boxes.Bounds): PositionResult => {
  const { x: boundsX, y: boundsY, right: boundsRight, bottom: boundsBottom } = bounds;
  const { x, y, right, bottom, width, height } = box;

  // simple checks for "is the top left inside the view"
  const xInBounds = x >= boundsX;
  const yInBounds = y >= boundsY;
  const originInBounds = xInBounds && yInBounds;

  // simple checks for "is the bottom right inside the view"
  const rightInBounds = right <= boundsRight;
  const bottomInBounds = bottom <= boundsBottom;
  const sizeInBounds = rightInBounds && bottomInBounds;

  // measure how much of the width and height are visible
  const deltaW = Math.min(width, xInBounds ? boundsRight - x : right - boundsX);
  const deltaH = Math.min(height, yInBounds ? boundsBottom - y : bottom - boundsY);

  return {
    originInBounds,
    sizeInBounds,
    deltaW,
    deltaH
  };
};

const attempt = (candidate: SpotInfo, width: number, height: number, bounds: Boxes.Bounds): BounderAttemptAdt => {
  const candidateX = candidate.x;
  const candidateY = candidate.y;
  const bubbleOffset = candidate.bubble.offset;

  // adjust the bounds to account for the layout and bubble restrictions
  const layoutBounds = LayoutBounds.calcBounds(bounds, candidate.restriction, bubbleOffset);

  // candidate position is excluding the bubble, so add those values as well
  const newX = candidateX + bubbleOffset.left;
  const newY = candidateY + bubbleOffset.top;
  const box = Boxes.bounds(newX, newY, width, height);

  // determine the position of the box in relation to the bounds
  const { originInBounds, sizeInBounds, deltaW, deltaH } = determinePosition(box, layoutBounds);

  // restrict the box if it won't fit in the bounds
  const fits = originInBounds && sizeInBounds;
  const fittedBox = fits ? box : calcReposition(box, layoutBounds, bounds);

  // Futz with the "height" of the popup to ensure if it doesn't fit it's capped at the available height.
  const upAvailable = Fun.constant(fittedBox.bottom - bounds.y);
  const downAvailable = Fun.constant(bounds.bottom - fittedBox.y);
  const maxHeight = Direction.cataVertical(candidate.direction, downAvailable, /* middle */ downAvailable, upAvailable);

  // Futz with the "width" of the popup to ensure if it doesn't fit it's capped at the available width.
  const westAvailable = Fun.constant(fittedBox.right - bounds.x);
  const eastAvailable = Fun.constant(bounds.right - fittedBox.x);
  const maxWidth = Direction.cataHorizontal(candidate.direction, eastAvailable, /* middle */ eastAvailable, westAvailable);

  const reposition: RepositionDecision = {
    rect: fittedBox,
    maxHeight,
    maxWidth,
    direction: candidate.direction,
    placement: candidate.placement,
    classes: {
      on: candidate.bubble.classesOn,
      off: candidate.bubble.classesOff
    },
    label: candidate.label,
    testY: newY
  };

  // useful debugging that I don't want to lose
  // console.log(candidate.label);
  // console.table([{
  //   newY,
  //   limitY: fittedBox.y,
  //   boundsY: bounds.y,
  //   boundsBottom: bounds.bottom,
  //   newX,
  //   limitX: fittedBox.x,
  //   boundsX: bounds.x,
  //   boundsRight: bounds.right,
  //   candidateX: candidate.x,
  //   candidateY: candidate.y,
  //   width,
  //   height
  // }]);
  // console.log('maxwidth:', deltaW, maxWidth);
  // console.log('maxheight:', deltaH, maxHeight);
  // console.log('originInBounds:', originInBounds);
  // console.log('sizeInBounds:', sizeInBounds);
  // console.log(originInBounds && sizeInBounds ? 'fit' : 'nofit');

  // Take special note that we don't use the futz values in the nofit case; whether this position is a good fit is separate
  // to ensuring that if we choose it the popup is actually on screen properly.
  return fits || candidate.alwaysFit ? adt.fit(reposition) : adt.nofit(reposition, deltaW, deltaH);
};

/**
 * Attempts to fit a box (generally a menu).
 *
 * candidates: an array of layout generators, generally obtained via api.Layout or api.LinkedLayout
 * anchorBox: the box on screen that triggered the menu, we must touch one of the edges as defined by the candidate layouts
 * elementBox: the popup (only width and height matter)
 * bubbles: the bubbles for the popup (see api.Bubble)
 * bounds: the screen
 */
const attempts = (element: SugarElement<HTMLElement>, candidates: AnchorLayout[], anchorBox: AnchorBox, elementBox: AnchorElement, bubbles: Bubble, bounds: Boxes.Bounds): RepositionDecision => {
  const panelWidth = elementBox.width;
  const panelHeight = elementBox.height;
  const attemptBestFit = (layout: AnchorLayout, reposition: RepositionDecision, deltaW: number, deltaH: number) => {
    const next: SpotInfo = layout(anchorBox, elementBox, bubbles, element);
    const attemptLayout = attempt(next, panelWidth, panelHeight, bounds);

    // unwrapping fit only to rewrap seems... silly
    return attemptLayout.fold(adt.fit, (newReposition, newDeltaW, newDeltaH) => {
      // console.log(`label: ${next.label()}, newDeltaW: ${newDeltaW}, deltaW: ${deltaW}, newDeltaH: ${newDeltaH}, deltaH: ${deltaH}`);
      const improved = newDeltaH > deltaH || newDeltaW > deltaW;
      // console.log('improved? ', improved);
      // re-wrap in the ADT either way
      return improved ? adt.nofit(newReposition, newDeltaW, newDeltaH)
        : adt.nofit(reposition, deltaW, deltaH);
    });
  };

  const abc = Arr.foldl(
    candidates,
    (b, a) => {
      const bestNext = Fun.curry(attemptBestFit, a);
      // unwrapping fit only to rewrap seems... silly
      return b.fold(adt.fit, bestNext);
    },
    // fold base case: No candidates, it's never going to be correct, so do whatever
    adt.nofit({
      rect: anchorBox,
      maxHeight: elementBox.height,
      maxWidth: elementBox.width,
      direction: Direction.southeast(),
      placement: Placement.southeast,
      classes: {
        on: [],
        off: []
      },
      label: 'none',
      testY: anchorBox.y
    }, -1, -1)
  );

  // unwrapping 'reposition' from the adt, for both fit & nofit the first arg is the one we need,
  // so we can cheat and use Fun.identity
  return abc.fold(Fun.identity, Fun.identity);
};

export { attempts, calcReposition };
