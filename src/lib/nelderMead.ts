// Generic Nelder-Mead simplex minimiser. Used by M5 TPA curve fitter;
// could subsume the specialized 3-param fit in lib/airspeedFit.ts in
// a future cleanup pass (left alone for now — the specialized version
// works and changing it would balloon the M5 slice).
//
// Standard textbook implementation (Nelder & Mead 1965): reflect →
// expand → contract → shrink. Termination on either the max-min
// simplex value range falling below `tolerance`, or hitting maxIter.
//
// For N-dim problems uses a 2N-vertex simplex (each axis perturbed
// up and down by `step`), which gives more stable convergence than
// the textbook (N+1)-vertex version when seed isn't great.

export interface NelderMeadOptions {
  /** Max iterations before termination. Default 800. */
  maxIter?: number;
  /** Convergence threshold on max-min simplex value range. Default 1e-7. */
  tolerance?: number;
  /** Initial simplex perturbation as a fraction of seed magnitude.
   *  Default 0.1 (so a seed value of 0.5 perturbs ±0.05). For
   *  near-zero seed components, falls back to absolute 0.05. */
  initialStep?: number;
}

export interface NelderMeadResult {
  /** Best-found point. */
  x: number[];
  /** Cost at `x`. */
  loss: number;
  /** Converged before hitting maxIter. */
  converged: boolean;
  iterations: number;
}

interface Vertex {
  x: number[];
  loss: number;
}

/** Minimise `cost(x)` over R^N starting from `seed`. */
export function fitNelderMead(
  seed: readonly number[],
  cost: (x: number[]) => number,
  options: NelderMeadOptions = {},
): NelderMeadResult {
  const maxIter = options.maxIter ?? 800;
  const tolerance = options.tolerance ?? 1e-7;
  const initialStep = options.initialStep ?? 0.1;

  const n = seed.length;
  if (n === 0) {
    return { x: [], loss: cost([]), converged: true, iterations: 0 };
  }

  // Build initial simplex: seed plus n perturbations along each axis.
  // (N+1)-vertex form keeps memory/compute proportional to dim.
  const simplex: Vertex[] = [];
  const seedArr = [...seed];
  simplex.push({ x: seedArr, loss: cost(seedArr) });
  for (let i = 0; i < n; i++) {
    const v = [...seedArr];
    const mag = Math.abs(v[i]);
    const step = mag > 1e-6 ? initialStep * mag : 0.05;
    v[i] += step;
    simplex.push({ x: v, loss: cost(v) });
  }

  let iterations = 0;
  let converged = false;

  while (iterations < maxIter) {
    simplex.sort((a, b) => a.loss - b.loss);

    const best = simplex[0];
    const worst = simplex[n];
    const secondWorst = simplex[n - 1];

    const range = worst.loss - best.loss;
    if (range < tolerance) {
      converged = true;
      break;
    }

    // Centroid of all-but-worst.
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j];
    }
    for (let j = 0; j < n; j++) centroid[j] /= n;

    // Reflection (α = 1).
    const reflected = new Array<number>(n);
    for (let j = 0; j < n; j++) reflected[j] = centroid[j] + (centroid[j] - worst.x[j]);
    const lossR = cost(reflected);

    if (lossR < secondWorst.loss && lossR >= best.loss) {
      simplex[n] = { x: reflected, loss: lossR };
      iterations++;
      continue;
    }

    // Expansion (γ = 2) — try further past reflection.
    if (lossR < best.loss) {
      const expanded = new Array<number>(n);
      for (let j = 0; j < n; j++) expanded[j] = centroid[j] + 2 * (centroid[j] - worst.x[j]);
      const lossE = cost(expanded);
      simplex[n] = lossE < lossR
        ? { x: expanded,  loss: lossE }
        : { x: reflected, loss: lossR };
      iterations++;
      continue;
    }

    // Contraction (ρ = 0.5) — pull worst toward centroid.
    const contracted = new Array<number>(n);
    for (let j = 0; j < n; j++) contracted[j] = centroid[j] + 0.5 * (worst.x[j] - centroid[j]);
    const lossC = cost(contracted);
    if (lossC < worst.loss) {
      simplex[n] = { x: contracted, loss: lossC };
      iterations++;
      continue;
    }

    // Shrink (σ = 0.5) — pull all-but-best toward best.
    for (let i = 1; i <= n; i++) {
      const shrunk = new Array<number>(n);
      for (let j = 0; j < n; j++) shrunk[j] = best.x[j] + 0.5 * (simplex[i].x[j] - best.x[j]);
      simplex[i] = { x: shrunk, loss: cost(shrunk) };
    }
    iterations++;
  }

  simplex.sort((a, b) => a.loss - b.loss);
  return {
    x: simplex[0].x,
    loss: simplex[0].loss,
    converged,
    iterations,
  };
}
