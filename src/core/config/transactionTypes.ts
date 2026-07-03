import { TransactionType } from "../models/Transaction";

export const TRANSACTION_KEYWORDS = {

ISSUE:[
"issue",
"invoice",
"sale",
"debit"
],

REFUND:[
"refund",
"rv",
"credit"
],

FUND:[
"fund",
"deposit",
"topup"
],

ADM:[
"adm"
],

ACM:[
"acm"
]

} satisfies Record<string,string[]>;