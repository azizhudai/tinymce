import { SugarElement } from '@ephox/sugar';
import { nu as NuSpotInfo } from '../view/SpotInfo';
import { Bubble } from './Bubble';
import * as Direction from './Direction';
import { AnchorBoxBounds, boundsRestriction } from './LayoutBounds';
import { AnchorBox, AnchorElement, AnchorLayout } from './LayoutTypes';
import * as Placement from './Placement';

/*
  Layouts for things that go inside the editable area.
  Designed for use with fixed_toolbar_container.
  See the LayoutInsideDemo for examples.
 */

const labelPrefix = 'layout-inner';

// returns left edge of anchor - used to display element to the left, left edge against the anchor
const westEdgeX = (anchor: AnchorBox): number => anchor.x;

// returns middle of anchor minus half the element width - used to horizontally centre element to the anchor
const middleX = (anchor: AnchorBox, element: AnchorElement): number => anchor.x + (anchor.width / 2) - (element.width / 2);

// returns right edge of anchor minus element width - used to display element to the right, right edge against the anchor
const eastEdgeX = (anchor: AnchorBox, element: AnchorElement): number => anchor.x + anchor.width - element.width;

// returns top edge - used to display element to the top, top edge against the anchor
const northY = (anchor: AnchorBox): number => anchor.y;

// returns bottom edge minus element height - used to display element at the bottom, bottom edge against the anchor
const southY = (anchor: AnchorBox, element: AnchorElement): number => anchor.y + anchor.height - element.height;

// returns centre of anchor minus half the element height - used to vertically centre element to the anchor
const centreY = (anchor: AnchorBox, element: AnchorElement): number => anchor.y + (anchor.height / 2) - (element.height / 2);

// positions element in bottom right of the anchor
const southeast: AnchorLayout = (anchor: AnchorBox, element: AnchorElement, bubbles: Bubble) => NuSpotInfo(
  eastEdgeX(anchor, element),
  southY(anchor, element),
  bubbles.innerSoutheast(),
  Direction.northwest(),
  Placement.southeast,
  boundsRestriction(anchor, { right: AnchorBoxBounds.RightEdge, bottom: AnchorBoxBounds.BottomEdge }),
  labelPrefix
);

// positions element in the bottom left of the anchor
const southwest: AnchorLayout = (anchor: AnchorBox, element: AnchorElement, bubbles: Bubble) => NuSpotInfo(
  westEdgeX(anchor),
  southY(anchor, element),
  bubbles.innerSouthwest(),
  Direction.northeast(),
  Placement.southwest,
  boundsRestriction(anchor, { left: AnchorBoxBounds.LeftEdge, bottom: AnchorBoxBounds.BottomEdge }),
  labelPrefix
);

// positions element in the top right of the anchor
const northeast: AnchorLayout = (anchor: AnchorBox, element: AnchorElement, bubbles: Bubble) => NuSpotInfo(
  eastEdgeX(anchor, element),
  northY(anchor),
  bubbles.innerNortheast(),
  Direction.southwest(),
  Placement.northeast,
  boundsRestriction(anchor, { right: AnchorBoxBounds.RightEdge, top: AnchorBoxBounds.TopEdge }),
  labelPrefix
);

// positions element in the top left of the anchor
const northwest: AnchorLayout = (anchor: AnchorBox, element: AnchorElement, bubbles: Bubble) => NuSpotInfo(
  westEdgeX(anchor),
  northY(anchor),
  bubbles.innerNorthwest(),
  Direction.southeast(),
  Placement.northwest,
  boundsRestriction(anchor, { left: AnchorBoxBounds.LeftEdge, top: AnchorBoxBounds.TopEdge }),
  labelPrefix
);

// positions element at the top of the anchor, horizontally centered
const north: AnchorLayout = (anchor: AnchorBox, element: AnchorElement, bubbles: Bubble) => NuSpotInfo(
  middleX(anchor, element),
  northY(anchor),
  bubbles.innerNorth(),
  Direction.south(),
  Placement.north,
  boundsRestriction(anchor, { top: AnchorBoxBounds.TopEdge }),
  labelPrefix
);

// positions element at the bottom of the anchor, horizontally centered
const south: AnchorLayout = (anchor: AnchorBox, element: AnchorElement, bubbles: Bubble) => NuSpotInfo(
  middleX(anchor, element),
  southY(anchor, element),
  bubbles.innerSouth(),
  Direction.north(),
  Placement.south,
  boundsRestriction(anchor, { bottom: AnchorBoxBounds.BottomEdge }),
  labelPrefix
);

// positions element with right edge against the anchor, vertically centered
const east: AnchorLayout = (anchor: AnchorBox, element: AnchorElement, bubbles: Bubble) => NuSpotInfo(
  eastEdgeX(anchor, element),
  centreY(anchor, element),
  bubbles.innerEast(),
  Direction.west(),
  Placement.east,
  boundsRestriction(anchor, { right: AnchorBoxBounds.RightEdge }),
  labelPrefix
);

// positions element with left each against the anchor, vertically centered
const west: AnchorLayout = (anchor: AnchorBox, element: AnchorElement, bubbles: Bubble) => NuSpotInfo(
  westEdgeX(anchor),
  centreY(anchor, element),
  bubbles.innerWest(),
  Direction.east(),
  Placement.west,
  boundsRestriction(anchor, { left: AnchorBoxBounds.LeftEdge }),
  labelPrefix
);

const all = (): AnchorLayout[] => [ southeast, southwest, northeast, northwest, south, north, east, west ];
const allRtl = (): AnchorLayout[] => [ southwest, southeast, northwest, northeast, south, north, east, west ];

const getLayoutForLastPlacement = (lastPlacement: Placement.Placement) => {
  switch (lastPlacement) {
    case Placement.north:
      return north;
    case Placement.northeast:
      return northeast;
    case Placement.northwest:
      return northwest;
    case Placement.south:
      return south;
    case Placement.southeast:
      return southwest;
    case Placement.southwest:
      return southeast;
    case Placement.east:
      return east;
    case Placement.west:
      return west;
  }
};

const preserve: AnchorLayout = (
  anchor: AnchorBox,
  element: AnchorElement,
  bubbles: Bubble,
  placee: SugarElement<HTMLElement>
) => {
  const lastPlacement = Placement.getPlacement(placee).getOr(Placement.north);
  const layout = getLayoutForLastPlacement(lastPlacement);
  return {
    ...layout(anchor, element, bubbles, placee),
    alwaysFit: true
  };
};

export {
  southeast,
  northeast,
  southwest,
  northwest,
  south,
  north,
  east,
  west,
  all,
  allRtl,
  preserve
};
