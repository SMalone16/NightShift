const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");

const TILE = 32;

function makeDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function saveSprite(filepath, drawFn) {
  const canvas = createCanvas(TILE, TILE);
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0,0,TILE,TILE);
  drawFn(ctx);

  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(filepath, buffer);
}

function square(ctx,color) {
  ctx.fillStyle=color;
  ctx.fillRect(0,0,TILE,TILE);
}

function circle(ctx,color,x,y,r){
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fill();
}

const base = "client/assets/sprites";

makeDir(base+"/tiles");
makeDir(base+"/player/idle");
makeDir(base+"/player/walk");
makeDir(base+"/player/slingshot");
makeDir(base+"/enemy");
makeDir(base+"/projectile");
makeDir(base+"/floor");

//
// TILES
//

saveSprite(base+"/tiles/tree.png",(ctx)=>{
  square(ctx,"#1e5f2c");
  circle(ctx,"#2ea043",16,12,10);
  ctx.fillStyle="#4b2e05";
  ctx.fillRect(14,18,4,10);
});

saveSprite(base+"/tiles/rock.png",(ctx)=>{
  square(ctx,"#222");
  ctx.fillStyle="#777";
  ctx.fillRect(6,10,20,14);
});

saveSprite(base+"/tiles/chest_closed.png",(ctx)=>{
  square(ctx,"#332200");
  ctx.fillStyle="#c48b2f";
  ctx.fillRect(4,12,24,12);
  ctx.fillStyle="#5a3c08";
  ctx.fillRect(4,8,24,6);
});

//
// PLAYER IDLE
//

saveSprite(base+"/player/idle/down.png",(ctx)=>{
  square(ctx,"#00000000");
  circle(ctx,"#3aa6ff",16,16,10);
});

//
// PLAYER WALK
//

saveSprite(base+"/player/walk/left_0.png",(ctx)=>{
  circle(ctx,"#3aa6ff",16,16,10);
});

saveSprite(base+"/player/walk/left_1.png",(ctx)=>{
  circle(ctx,"#2d89d1",16,16,10);
});

saveSprite(base+"/player/walk/left_2.png",(ctx)=>{
  circle(ctx,"#1e5f9c",16,16,10);
});

//
// SLINGSHOT FIRE
//

saveSprite(base+"/player/slingshot/fire_left_0.png",(ctx)=>{
  circle(ctx,"#ff4d4d",16,16,10);
});

saveSprite(base+"/player/slingshot/fire_left_1.png",(ctx)=>{
  circle(ctx,"#ff7a7a",16,16,10);
});

saveSprite(base+"/player/slingshot/fire_left_2.png",(ctx)=>{
  circle(ctx,"#ffa3a3",16,16,10);
});

//
// ENEMY PLACEHOLDER
//

saveSprite(base+"/enemy/enemy.png",(ctx)=>{
  circle(ctx,"#7a1fa2",16,16,10);
});

//
// PROJECTILE
//

saveSprite(base+"/projectile/stone.png",(ctx)=>{
  circle(ctx,"#999",16,16,6);
});

//
// FLOOR
//

saveSprite(base+"/floor/grass.png",(ctx)=>{
  square(ctx,"#3b7a2a");
});

saveSprite(base+"/floor/path.png",(ctx)=>{
  square(ctx,"#8b6b3f");
});

console.log("NightShift asset pack generated.");
