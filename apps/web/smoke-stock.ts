import { rollupStock } from "./src/lib/reports.ts";
let fail=0; const eq=(l,g,w)=>{ if(JSON.stringify(g)!==JSON.stringify(w)){fail++;console.log("✗",l,"got",JSON.stringify(g),"want",JSON.stringify(w));}else console.log("✓",l); };
const rows=[
  {item_id:"a",item_name:"Dolo",qty:10,mrp_paise:3150,ptr_paise:2500,stock_value_paise:25000},
  {item_id:"a",item_name:"Dolo",qty:5,mrp_paise:3150,ptr_paise:2480,stock_value_paise:12400},
  {item_id:"b",item_name:"Pan",qty:2,mrp_paise:16800,ptr_paise:13200,stock_value_paise:26400},
];
const agg=rollupStock(rows);
eq("top by cost is Pan", agg[0].name, "Pan");
eq("Dolo qty merged", agg.find(x=>x.itemId==="a").qty, 15);
eq("Dolo batches", agg.find(x=>x.itemId==="a").batches, 2);
eq("Dolo cost", agg.find(x=>x.itemId==="a").costPaise, 37400);
eq("Dolo mrp value", agg.find(x=>x.itemId==="a").mrpPaise, 15*3150);
console.log(fail===0?"ALL PASS":fail+" FAIL"); if(fail)process.exit(1);
