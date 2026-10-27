/** One shape definition for the animated surface and its static poster. */
export function surface(x: number, z: number, time: number): [number, number, number] {
 const phase = x * .22 + z * .13 + time * .12;
 const ridge = Math.exp(-(((z + 5) / 5) ** 2)), swell = x * .16 + 1.1 + time * .09;
 return [
  -.8 + .018 * x * x + .75 * Math.sin(phase) + 2.2 * ridge * Math.sin(swell),
  .036 * x + .165 * Math.cos(phase) + .352 * ridge * Math.cos(swell),
  .0975 * Math.cos(phase) - 2.2 * ridge * 2 * (z + 5) / 25 * Math.sin(swell),
 ];
}
export const waveGLSL = `
vec3 surface(float x,float z,float time){
 float phase=x*.22+z*.13+time*.12;
 float ridge=exp(-pow((z+5.)/5.,2.)),swell=x*.16+1.1+time*.09;
 return vec3(-.8+.018*x*x+.75*sin(phase)+2.2*ridge*sin(swell),
 .036*x+.165*cos(phase)+.352*ridge*cos(swell),
 .0975*cos(phase)-2.2*ridge*2.*(z+5.)/25.*sin(swell));
}`;
export function fieldTiles(mobile: boolean): [number, number, number][] {
 const columns = mobile ? 55 : 67, rows = mobile ? 19 : 27, tiles: [number, number, number][] = [];
 for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) {
  if (((i * 17 + j * 13) % 29 === 0 && j < 8) || (i * 19 + j * 23) % 83 === 0) continue;
  const x = (i - (columns - 1) / 2) * .66;
  const z = (j - (rows - 1) / 2) * .83 + 1.65 * Math.sin(x * .18) - 1;
  // Open a channel between the two foreground ribbons.
  if (z > 2.5 && Math.abs(x - 2.5) < (z - 2.5) * .47 + .4) continue;
  tiles.push([x, z, tiles.length]);
 }
 return tiles;
}
export const sceneView = (width: number) => ({ eye: [0, width < 700 ? 8.5 : 6.1, width < 700 ? 20 : 16] as [number, number, number], target: [0, 0, -3] as [number, number, number], shift: width < 700 ? .26 : .22 });
