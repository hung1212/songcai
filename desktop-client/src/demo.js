import { PARSER_VERSION } from './core/business-syntax.js';
export const demoText = `小明：旧 1 2 3 各100元
特肖虎 100元

张三：特肖虎100元
新 12 24 36 各50
三中三 01 13 25 37 各20

阿青：两边 08 20 32 44 各25
平特肖马100

林先生：港 六肖中特虎牛兔马蛇龙100
二连肖虎兔牛各50
0尾各30

小明：新 05 17 29 各20
五不中 01 02 03 04 05 06 各10

张三：旧 12各80
50 03 各10
特串5`;

export const makeDocument = (name = '新建文本.og', text = '', businessDate) => ({ id: crypto.randomUUID(), name, text, businessDate, defaultPlayer: '', parserVersion:PARSER_VERSION });
