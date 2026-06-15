// JS port of automaton_utils.py.
//
// Both functions operate directly on Spot automaton objects, which have no JS
// equivalent. Spot support was dropped in the JS port (see spot_utils.js), so
// these are stubs. They are only reachable via batch_check.js's Spot-only
// `get_aut_product` path, which is itself stubbed.

export function getDestList(_aut, _dst) {
  throw new Error('getDestList: Spot support was dropped in the JS port');
}

export function getAutNumSteps(_inAut, _maxSteps) {
  throw new Error('getAutNumSteps: Spot support was dropped in the JS port');
}
