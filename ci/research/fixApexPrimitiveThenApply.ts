import{execFileSync}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';
const p='tools/visualizer/public/lib/chart.mjs',src=readFileSync(p,'utf8');
const a=src.indexOf('function makeApexPrimitive()'),b=src.indexOf('/** Зона под курсором',a);if(a<0||b<0)throw Error(`Apex primitive markers missing a=${a} b=${b}`);
const fixed=`function makeApexPrimitive() {
\tconst p = {
\t\t_bands: [], _opts: {}, _ctx: null,
\t\tattached(x) { p._ctx = x },
\t\tdetached() { p._ctx = null },
\t\tsetBands(x, o = {}) { p._bands = x; p._opts = o; p._ctx?.requestUpdate?.() },
\t\tpaneViews() { return p._views },
\t}
\tconst renderer = {
\t\tdraw(target) {
\t\t\tconst a = p._ctx
\t\t\tif (!a || p._bands.length < 2) return
\t\t\tconst ts = a.chart.timeScale()
\t\t\ttarget.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: h, verticalPixelRatio: v }) => {
\t\t\t\tconst zone = (hi, lo, color, on) => {
\t\t\t\t\tif (!on) return
\t\t\t\t\tc.beginPath()
\t\t\t\t\tlet started = false
\t\t\t\t\tfor (const band of p._bands) {
\t\t\t\t\t\tconst x = ts.timeToCoordinate(band.t), y = a.series.priceToCoordinate(band[hi])
\t\t\t\t\t\tif (x == null || y == null) continue
\t\t\t\t\t\tc[started ? 'lineTo' : 'moveTo'](x * h, y * v)
\t\t\t\t\t\tstarted = true
\t\t\t\t\t}
\t\t\t\t\tfor (let i = p._bands.length - 1; i >= 0; i--) {
\t\t\t\t\t\tconst band = p._bands[i]
\t\t\t\t\t\tconst x = ts.timeToCoordinate(band.t), y = a.series.priceToCoordinate(band[lo])
\t\t\t\t\t\tif (x != null && y != null) c.lineTo(x * h, y * v)
\t\t\t\t\t}
\t\t\t\t\tif (started) { c.closePath(); c.fillStyle = color; c.globalAlpha = 0.11; c.fill(); c.globalAlpha = 1 }
\t\t\t\t}
\t\t\t\tzone('redHi', 'redLo', p._opts.upperColor, p._opts.upperOn)
\t\t\t\tzone('greenHi', 'greenLo', p._opts.lowerColor, p._opts.lowerOn)
\t\t\t})
\t\t},
\t}
\tp._views = [{ renderer: () => renderer }]
\treturn p
}

`;
writeFileSync(p,src.slice(0,a)+fixed+src.slice(b));
execFileSync('node',['--check',p],{stdio:'inherit'});
execFileSync('git',['add',p],{stdio:'inherit'});
const task='ci/research/applyDesignAndZoneFix.ts';let atom=readFileSync(task,'utf8');const imp="import { snapZoneTime } from '../tools/visualizer/public/panels/zones.mjs'";if(!atom.includes('@ts-expect-error Frontend .mjs')){if(!atom.includes(imp))throw Error('zone test import marker missing');atom=atom.replace(imp,"// @ts-expect-error Frontend .mjs intentionally has no TypeScript declaration\\n"+imp);writeFileSync(task,atom)}
execFileSync('npx',['tsx',task],{stdio:'inherit'});
