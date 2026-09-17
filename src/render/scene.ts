// M0 placeholder scene: a sky gradient over a flat soil color, so the pipeline
// (bootstrap, resize, deploy) is provable end to end before any real art or
// simulation exists. Replaced by the full art-directed scene in M1.
import { Application, FillGradient, Graphics } from 'pixi.js';
import { layout } from '../config';
import { strata, timeOfDay } from '../theme/palette';

export interface Scene {
  resize(width: number, height: number): void;
}

export function createScene(app: Application): Scene {
  const sky = new Graphics();
  const soil = new Graphics();
  app.stage.addChild(sky, soil);

  let gradient: FillGradient | undefined;

  function draw(width: number, height: number): void {
    const grassY = height * layout.skyFraction;

    gradient?.destroy();
    gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: timeOfDay.day.skyTop },
        { offset: 1, color: timeOfDay.day.skyHorizon },
      ],
    });

    sky.clear().rect(0, 0, width, grassY).fill(gradient);
    soil.clear().rect(0, grassY, width, height - grassY).fill(strata.topsoil);
  }

  draw(app.screen.width, app.screen.height);

  return {
    resize: draw,
  };
}
