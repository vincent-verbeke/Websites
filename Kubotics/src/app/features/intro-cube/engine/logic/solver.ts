import { MoveAxis } from './cube-state';

export interface CubeMove {
  axis: MoveAxis;
  slice: number;
  direction: 1 | -1;
}

export class RubiksSolver {
  private moveHistory: CubeMove[] = [];

  /**
   * Generates a random scramble sequence and records it.
   */
  generateScramble(steps = 20): CubeMove[] {
    const axes: MoveAxis[] = ['x', 'y', 'z'];
    const slices = [-1, 0, 1];
    const directions: (1 | -1)[] = [1, -1];
    const sequence: CubeMove[] = [];

    for (let i = 0; i < steps; i++) {
        const move: CubeMove = {
            axis: axes[Math.floor(Math.random() * axes.length)],
            slice: slices[Math.floor(Math.random() * slices.length)],
            direction: directions[Math.floor(Math.random() * directions.length)]
        };
        sequence.push(move);
        this.moveHistory.push(move);
    }

    return sequence;
  }

  /**
   * Returns the inverse of the moves recorded in history.
   * This guarantees a solve in the intro.
   */
  getSolveSequence(): CubeMove[] {
    const solve: CubeMove[] = [];
    for (let i = this.moveHistory.length - 1; i >= 0; i--) {
        const move = this.moveHistory[i];
        solve.push({
            axis: move.axis,
            slice: move.slice,
            direction: move.direction === 1 ? -1 : 1
        });
    }
    this.moveHistory = []; // Reset history after solving
    return solve;
  }
}
