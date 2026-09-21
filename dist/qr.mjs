import qrcode from './vendor/qrcode.mjs';

export function drawQR(canvas,value,{dark='#080b20',light='#ffffff'}={}){
  const code=qrcode(0,'M');code.addData(value);code.make();const modules=code.getModuleCount(),quiet=4,total=modules+quiet*2,size=canvas.width||180,cell=size/total,context=canvas.getContext('2d');context.imageSmoothingEnabled=false;context.fillStyle=light;context.fillRect(0,0,size,size);context.fillStyle=dark;for(let row=0;row<modules;row++)for(let column=0;column<modules;column++)if(code.isDark(row,column)){const x=Math.floor((column+quiet)*cell),y=Math.floor((row+quiet)*cell),right=Math.ceil((column+quiet+1)*cell),bottom=Math.ceil((row+quiet+1)*cell);context.fillRect(x,y,right-x,bottom-y);}
}
