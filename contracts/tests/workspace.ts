import { LiteSVM, FailedTransactionMetadata } from "litesvm";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  getAddressCodec,
  getProgramDerivedAddress,
  lamports,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import fs from "fs";
import path from "path";
import * as priceMath from "../../src/lib/priceMath";
import { decodeDealAccount, DEAL_ACCOUNT_SIZE } from "../../src/lib/dealCodec";

const idl = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "target/idl/workspace.json"), "utf8")
);
const coder = new anchor.BorshCoder(idl);
const programAddress = address((idl as any).address);
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const TREASURY = address("BtxpihJkeuj5MdtYoRWfRC2VJQfxTg4Fwht44mQp7Sk");
const addressCodec = getAddressCodec();
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const USDC_MINT = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

type Signer = Awaited<ReturnType<typeof generateKeyPairSigner>>;

describe("safe_deal escrow", () => {
  let svm: LiteSVM;
  let nowTs: bigint;
  let dealCounter = 1;
  const ONE_SOL = 1_000_000_000n;

  async function buildTx(ix: any, payer: any) {
    const msg = appendTransactionMessageInstruction(
      ix,
      setTransactionMessageFeePayerSigner(payer, createTransactionMessage({ version: 0 }))
    );
    const withLifetime = svm.setTransactionMessageLifetimeUsingLatestBlockhash(msg);
    return signTransactionMessageWithSigners(withLifetime, { abortSignal: undefined });
  }

  async function sendIx(ix: any, payer: any) {
    const tx = await buildTx(ix, payer);
    const res = svm.sendTransaction(tx);
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(res.meta().prettyLogs());
    }
    svm.expireBlockhash();
    return res;
  }

  async function expectFailure(ix: any, payer: any, includes: string) {
    const tx = await buildTx(ix, payer);
    const res = svm.simulateTransaction(tx);
    expect(res).to.be.instanceOf(FailedTransactionMetadata);
    const logText = (res as FailedTransactionMetadata).meta().logs().join("\n");
    expect(logText).to.include(includes);
  }

  function fetchDeal(addr: Address): any {
    const acc = svm.getAccount(addr);
    if (!acc || ("exists" in acc && !(acc as any).exists)) {
      throw new Error(`Missing deal at ${addr}`);
    }
    return coder.accounts.decode("Deal", Buffer.from(acc.data));
  }

  function toAddressString(value: any): string {
    if (typeof value === "string") return value;
    if (value instanceof Uint8Array) return addressCodec.decode(value);
    if (value && typeof value.toBase58 === "function") return value.toBase58();
    if (value && typeof value.length === "number")
      return addressCodec.decode(Uint8Array.from(value));
    throw new Error("Unable to decode address");
  }

  function balanceOf(addr: Address): bigint {
    const b = svm.getBalance(addr);
    return b === null || b === undefined ? 0n : BigInt(b);
  }

  function statusName(status: any): string {
    return Object.keys(status)[0].toLowerCase();
  }

  function setTime(ts: bigint) {
    const clock = svm.getClock();
    clock.unixTimestamp = ts;
    svm.setClock(clock);
  }

  async function dealPDA(creator: Address, dealId: BN): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress,
      seeds: [
        new TextEncoder().encode("deal"),
        addressCodec.encode(creator),
        dealId.toArrayLike(Buffer, "le", 8),
      ],
    });
    return pda;
  }

  async function newSigner(sol: bigint = 10n): Promise<Signer> {
    const s = await generateKeyPairSigner();
    svm.airdrop(s.address, lamports(sol * ONE_SOL));
    return s;
  }

  function initDealIx(creator: Signer, deal: Address, args: any) {
    return {
      programAddress,
      accounts: [
        { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
        { address: deal, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ],
      data: coder.instruction.encode("initialize_deal", args),
    };
  }

  function fundDealIx(creator: Signer, deal: Address) {
    return {
      programAddress,
      accounts: [
        { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
        { address: deal, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ],
      data: coder.instruction.encode("fund_deal", {}),
    };
  }

  function submitWorkIx(worker: Signer, deal: Address, submission: string) {
    return {
      programAddress,
      accounts: [
        { address: worker.address, role: AccountRole.WRITABLE_SIGNER, signer: worker },
        { address: deal, role: AccountRole.WRITABLE },
      ],
      data: coder.instruction.encode("submit_work", { submission }),
    };
  }

  function approveDealIx(creator: Signer, deal: Address, worker: Address, treasury: Address = TREASURY) {
    return {
      programAddress,
      accounts: [
        { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
        { address: deal, role: AccountRole.WRITABLE },
        { address: worker, role: AccountRole.WRITABLE },
        { address: treasury, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ],
      data: coder.instruction.encode("approve_deal", {}),
    };
  }

  function cancelDealIx(creator: Signer, deal: Address) {
    return {
      programAddress,
      accounts: [
        { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
        { address: deal, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      ],
      data: coder.instruction.encode("cancel_deal", {}),
    };
  }

  function dealArgs(dealId: BN, overrides: any = {}) {
    return {
      deal_id: dealId,
      title: "Landing page",
      description: "Build a landing page",
      amount: new BN(ONE_SOL.toString()),
      deadline: new BN((nowTs + 3600n).toString()),
      worker: null,
      ...overrides,
    };
  }

  async function createDeal(creator: Signer, overrides: any = {}) {
    const dealId = new BN(dealCounter++);
    const deal = await dealPDA(creator.address, dealId);
    await sendIx(initDealIx(creator, deal, dealArgs(dealId, overrides)), creator);
    return { deal, dealId };
  }

  async function createFundedDeal(creator: Signer, overrides: any = {}) {
    const d = await createDeal(creator, overrides);
    await sendIx(fundDealIx(creator, d.deal), creator);
    return d;
  }

  before(async () => {
    svm = new LiteSVM()
      .withSysvars()
      .withBuiltins()
      .withTransactionHistory(0n)
      .withLogBytesLimit(256n * 1024n);
    const anySvm: any = svm;
    if (typeof anySvm.withDefaultPrograms === "function") svm = anySvm.withDefaultPrograms();
    else if (typeof anySvm.withSplPrograms === "function") svm = anySvm.withSplPrograms();
    svm.addProgramFromFile(programAddress, "target/deploy/workspace.so");
    nowTs = BigInt(Math.floor(Date.now() / 1000));
    setTime(nowTs);
    svm.airdrop(TREASURY, lamports(ONE_SOL));
  });

  beforeEach(() => setTime(nowTs));

  it("initializes an open deal", async () => {
    const creator = await newSigner();
    const { deal, dealId } = await createDeal(creator);
    const d = fetchDeal(deal);
    expect(d.deal_id.toString()).to.equal(dealId.toString());
    expect(toAddressString(d.creator)).to.equal(creator.address);
    expect(d.worker).to.equal(null);
    expect(d.amount.toString()).to.equal(ONE_SOL.toString());
    expect(statusName(d.status)).to.equal("created");
    expect(d.title).to.equal("Landing page");
    expect(d.submission).to.equal("");
    expect(d.created_at.toString()).to.equal(nowTs.toString());
  });

  it("initializes a deal with an assigned worker", async () => {
    const creator = await newSigner();
    const worker = await newSigner(1n);
    const { deal } = await createDeal(creator, { worker: new PublicKey(worker.address) });
    expect(toAddressString(fetchDeal(deal).worker)).to.equal(worker.address);
  });

  it("rejects invalid initialize params", async () => {
    const creator = await newSigner();
    const id = new BN(dealCounter++);
    const deal = await dealPDA(creator.address, id);
    await expectFailure(initDealIx(creator, deal, dealArgs(id, { title: "" })), creator, "TitleEmpty");
    await expectFailure(initDealIx(creator, deal, dealArgs(id, { title: "a".repeat(65) })), creator, "TitleTooLong");
    await expectFailure(initDealIx(creator, deal, dealArgs(id, { description: "" })), creator, "DescriptionEmpty");
    await expectFailure(initDealIx(creator, deal, dealArgs(id, { description: "a".repeat(257) })), creator, "DescriptionTooLong");
    await expectFailure(initDealIx(creator, deal, dealArgs(id, { amount: new BN(0) })), creator, "InvalidAmount");
    await expectFailure(initDealIx(creator, deal, dealArgs(id, { deadline: new BN(nowTs.toString()) })), creator, "InvalidDeadline");
    await expectFailure(
      initDealIx(creator, deal, dealArgs(id, { worker: new PublicKey(creator.address) })),
      creator,
      "WorkerIsCreator"
    );
  });

  it("funds a deal and escrows lamports in the PDA", async () => {
    const creator = await newSigner();
    const { deal } = await createDeal(creator);
    const before = balanceOf(deal);
    await sendIx(fundDealIx(creator, deal), creator);
    expect(balanceOf(deal) - before).to.equal(ONE_SOL);
    expect(statusName(fetchDeal(deal).status)).to.equal("funded");
    await expectFailure(fundDealIx(creator, deal), creator, "InvalidStatus");
  });

  it("rejects funding by a non-creator", async () => {
    const creator = await newSigner();
    const other = await newSigner();
    const { deal } = await createDeal(creator);
    await expectFailure(fundDealIx(other, deal), other, "ConstraintSeeds");
  });

  it("full flow: open deal claimed, approved with 2% fee", async () => {
    const creator = await newSigner();
    const worker = await newSigner(1n);
    const { deal } = await createFundedDeal(creator);
    await sendIx(submitWorkIx(worker, deal, "https://github.com/x/y"), worker);
    let d = fetchDeal(deal);
    expect(statusName(d.status)).to.equal("submitted");
    expect(toAddressString(d.worker)).to.equal(worker.address);
    expect(d.submission).to.equal("https://github.com/x/y");

    const wBefore = balanceOf(worker.address);
    const tBefore = balanceOf(TREASURY);
    const dBefore = balanceOf(deal);
    await sendIx(approveDealIx(creator, deal, worker.address), creator);
    const fee = (ONE_SOL * 200n) / 10000n;
    expect(balanceOf(worker.address) - wBefore).to.equal(ONE_SOL - fee);
    expect(balanceOf(TREASURY) - tBefore).to.equal(fee);
    expect(dBefore - balanceOf(deal)).to.equal(ONE_SOL);
    d = fetchDeal(deal);
    expect(statusName(d.status)).to.equal("completed");
  });

  it("rejects submit by creator on open deal", async () => {
    const creator = await newSigner();
    const { deal } = await createFundedDeal(creator);
    await expectFailure(submitWorkIx(creator, deal, "mine"), creator, "CreatorCannotSubmit");
  });

  it("rejects submit by non-assigned worker", async () => {
    const creator = await newSigner();
    const worker = await newSigner(1n);
    const other = await newSigner(1n);
    const { deal } = await createFundedDeal(creator, { worker: new PublicKey(worker.address) });
    await expectFailure(submitWorkIx(other, deal, "x"), other, "UnauthorizedWorker");
    await sendIx(submitWorkIx(worker, deal, "done"), worker);
    expect(statusName(fetchDeal(deal).status)).to.equal("submitted");
  });

  it("rejects submit on unfunded deal, too long, or after deadline", async () => {
    const creator = await newSigner();
    const worker = await newSigner(1n);
    const unfunded = await createDeal(creator);
    await expectFailure(submitWorkIx(worker, unfunded.deal, "x"), worker, "InvalidStatus");
    const { deal } = await createFundedDeal(creator);
    await expectFailure(submitWorkIx(worker, deal, "a".repeat(201)), worker, "SubmissionTooLong");
    setTime(nowTs + 3601n);
    await expectFailure(submitWorkIx(worker, deal, "late"), worker, "DeadlinePassed");
  });

  it("rejects approve with wrong worker, wrong treasury, or wrong status", async () => {
    const creator = await newSigner();
    const worker = await newSigner(1n);
    const other = await newSigner(1n);
    const { deal } = await createFundedDeal(creator);
    await expectFailure(approveDealIx(creator, deal, worker.address), creator, "WorkerMismatch");
    await sendIx(submitWorkIx(worker, deal, "done"), worker);
    await expectFailure(approveDealIx(creator, deal, other.address), creator, "WorkerMismatch");
    await expectFailure(approveDealIx(creator, deal, worker.address, other.address), creator, "InvalidTreasury");
  });

  it("cancels a created (unfunded) deal", async () => {
    const creator = await newSigner();
    const { deal } = await createDeal(creator);
    await sendIx(cancelDealIx(creator, deal), creator);
    expect(statusName(fetchDeal(deal).status)).to.equal("cancelled");
  });

  it("cancels a funded deal only after deadline with refund", async () => {
    const creator = await newSigner();
    const { deal } = await createFundedDeal(creator);
    await expectFailure(cancelDealIx(creator, deal), creator, "DeadlineNotPassed");
    setTime(nowTs + 3601n);
    const cBefore = balanceOf(creator.address);
    const dBefore = balanceOf(deal);
    await sendIx(cancelDealIx(creator, deal), creator);
    expect(dBefore - balanceOf(deal)).to.equal(ONE_SOL);
    expect(balanceOf(creator.address) > cBefore).to.equal(true);
    expect(statusName(fetchDeal(deal).status)).to.equal("cancelled");
  });

  it("cannot cancel a submitted deal", async () => {
    const creator = await newSigner();
    const worker = await newSigner(1n);
    const { deal } = await createFundedDeal(creator);
    await sendIx(submitWorkIx(worker, deal, "done"), worker);
    setTime(nowTs + 7200n);
    await expectFailure(cancelDealIx(creator, deal), creator, "InvalidStatus");
  });

  describe("USDC escrow", () => {
    let mintAuthority: Signer;
    let fakeMint: Address;
    let oddPaid: { fee: bigint; worker: bigint } | null = null;
    const USDC = 1_000_000n;

    function u64le(v: bigint): Uint8Array {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigUint64(0, v, true);
      return b;
    }

    function i64le(v: bigint): Uint8Array {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigInt64(0, v, true);
      return b;
    }

    function concat(parts: Uint8Array[]): Uint8Array {
      const total = parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of parts) {
        out.set(p, o);
        o += p.length;
      }
      return out;
    }

    function rentFor(size: number): bigint {
      return BigInt(svm.minimumBalanceForRentExemption(BigInt(size)));
    }

    function setRawAccount(addr: Address, owner: Address, data: Uint8Array, lamportsAmt?: bigint) {
      const amt = lamportsAmt ?? rentFor(data.length);
      const anySvm: any = svm;
      if (anySvm.setAccount.length >= 2) {
        anySvm.setAccount(addr, {
          lamports: amt,
          data,
          owner,
          programAddress: owner,
          executable: false,
          rentEpoch: 0,
        });
      } else {
        anySvm.setAccount({
          address: addr,
          lamports: lamports(amt),
          data,
          programAddress: owner,
          executable: false,
          space: BigInt(data.length),
        });
      }
    }

    function mintData(authority: Address, decimals = 6): Uint8Array {
      const d = new Uint8Array(82);
      const v = new DataView(d.buffer);
      v.setUint32(0, 1, true);
      d.set(addressCodec.encode(authority) as any, 4);
      d[44] = decimals;
      d[45] = 1;
      return d;
    }

    function accountExists(addr: Address): boolean {
      const acc: any = svm.getAccount(addr);
      if (!acc) return false;
      if ("exists" in acc && !acc.exists) return false;
      return true;
    }

    function tokenBalance(addr: Address): bigint {
      const acc: any = svm.getAccount(addr);
      if (!acc || ("exists" in acc && !acc.exists)) return 0n;
      const data = Uint8Array.from(acc.data);
      return new DataView(data.buffer).getBigUint64(64, true);
    }

    async function ataOf(owner: Address, mint: Address): Promise<Address> {
      const [a] = await getProgramDerivedAddress({
        programAddress: ATA_PROGRAM,
        seeds: [addressCodec.encode(owner), addressCodec.encode(TOKEN_PROGRAM), addressCodec.encode(mint)],
      });
      return a;
    }

    async function sendIxs(ixs: any[], payer: any) {
      let msg: any = setTransactionMessageFeePayerSigner(payer, createTransactionMessage({ version: 0 }));
      for (const ix of ixs) msg = appendTransactionMessageInstruction(ix, msg);
      const withLifetime = svm.setTransactionMessageLifetimeUsingLatestBlockhash(msg);
      const tx = await signTransactionMessageWithSigners(withLifetime as any, { abortSignal: undefined });
      const res = svm.sendTransaction(tx as any);
      if (res instanceof FailedTransactionMetadata) {
        throw new Error(res.meta().prettyLogs());
      }
      svm.expireBlockhash();
      return res;
    }

    function createAtaIx(payer: Signer, ata: Address, owner: Address, mint: Address) {
      return {
        programAddress: ATA_PROGRAM,
        accounts: [
          { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
          { address: ata, role: AccountRole.WRITABLE },
          { address: owner, role: AccountRole.READONLY },
          { address: mint, role: AccountRole.READONLY },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
        ],
        data: new Uint8Array([1]),
      };
    }

    function mintToIx(mint: Address, dest: Address, amount: bigint) {
      return {
        programAddress: TOKEN_PROGRAM,
        accounts: [
          { address: mint, role: AccountRole.WRITABLE },
          { address: dest, role: AccountRole.WRITABLE },
          { address: mintAuthority.address, role: AccountRole.READONLY_SIGNER, signer: mintAuthority },
        ],
        data: concat([new Uint8Array([7]), u64le(amount)]),
      };
    }

    async function giveUsdc(owner: Signer, amount: bigint, mint: Address = USDC_MINT): Promise<Address> {
      const ata = await ataOf(owner.address, mint);
      await sendIxs([createAtaIx(owner, ata, owner.address, mint), mintToIx(mint, ata, amount)], owner);
      return ata;
    }

    function tokenDealArgs(dealId: BN, overrides: any = {}) {
      return dealArgs(dealId, { amount: new BN((25n * USDC).toString()), ...overrides });
    }

    function initTokenDealIx(creator: Signer, deal: Address, mint: Address, vault: Address, args: any) {
      return {
        programAddress,
        accounts: [
          { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
          { address: deal, role: AccountRole.WRITABLE },
          { address: mint, role: AccountRole.READONLY },
          { address: vault, role: AccountRole.WRITABLE },
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
          { address: ATA_PROGRAM, role: AccountRole.READONLY },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ],
        data: coder.instruction.encode("initialize_token_deal", args),
      };
    }

    function fundTokenDealIx(creator: Signer, deal: Address, creatorAta: Address, vault: Address, mint: Address = USDC_MINT) {
      return {
        programAddress,
        accounts: [
          { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
          { address: deal, role: AccountRole.WRITABLE },
          { address: mint, role: AccountRole.READONLY },
          { address: creatorAta, role: AccountRole.WRITABLE },
          { address: vault, role: AccountRole.WRITABLE },
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
        ],
        data: coder.instruction.encode("fund_token_deal", {}),
      };
    }

    async function approveTokenDealIx(creator: Signer, deal: Address, worker: Address, treasury: Address = TREASURY) {
      const vault = await ataOf(deal, USDC_MINT);
      const workerAta = await ataOf(worker, USDC_MINT);
      const treasuryAta = await ataOf(treasury, USDC_MINT);
      return {
        programAddress,
        accounts: [
          { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
          { address: deal, role: AccountRole.WRITABLE },
          { address: USDC_MINT, role: AccountRole.READONLY },
          { address: vault, role: AccountRole.WRITABLE },
          { address: worker, role: AccountRole.READONLY },
          { address: workerAta, role: AccountRole.WRITABLE },
          { address: treasury, role: AccountRole.READONLY },
          { address: treasuryAta, role: AccountRole.WRITABLE },
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
          { address: ATA_PROGRAM, role: AccountRole.READONLY },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ],
        data: coder.instruction.encode("approve_token_deal", {}),
      };
    }

    async function cancelTokenDealIx(creator: Signer, deal: Address) {
      const vault = await ataOf(deal, USDC_MINT);
      const creatorAta = await ataOf(creator.address, USDC_MINT);
      return {
        programAddress,
        accounts: [
          { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
          { address: deal, role: AccountRole.WRITABLE },
          { address: USDC_MINT, role: AccountRole.READONLY },
          { address: vault, role: AccountRole.WRITABLE },
          { address: creatorAta, role: AccountRole.WRITABLE },
          { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
          { address: ATA_PROGRAM, role: AccountRole.READONLY },
          { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        ],
        data: coder.instruction.encode("cancel_token_deal", {}),
      };
    }

    async function createTokenDeal(creator: Signer, fund: boolean, overrides: any = {}) {
      const dealId = new BN(dealCounter++);
      const deal = await dealPDA(creator.address, dealId);
      const vault = await ataOf(deal, USDC_MINT);
      const creatorAta = await ataOf(creator.address, USDC_MINT);
      const ixs: any[] = [initTokenDealIx(creator, deal, USDC_MINT, vault, tokenDealArgs(dealId, overrides))];
      if (fund) ixs.push(fundTokenDealIx(creator, deal, creatorAta, vault));
      await sendIxs(ixs, creator);
      return { deal, dealId, vault, creatorAta };
    }

    before(async () => {
      mintAuthority = await generateKeyPairSigner();
      fakeMint = (await generateKeyPairSigner()).address;
      setRawAccount(USDC_MINT, TOKEN_PROGRAM, mintData(mintAuthority.address));
      setRawAccount(fakeMint, TOKEN_PROGRAM, mintData(mintAuthority.address));
    });

    it("initializes and funds a USDC deal in one transaction", async () => {
      const creator = await newSigner();
      const creatorAta = await giveUsdc(creator, 100n * USDC);
      const { deal, vault } = await createTokenDeal(creator, true);
      expect(tokenBalance(vault)).to.equal(25n * USDC);
      expect(tokenBalance(creatorAta)).to.equal(75n * USDC);
      const d = fetchDeal(deal);
      expect(toAddressString(d.mint)).to.equal(USDC_MINT);
      expect(statusName(d.status)).to.equal("funded");
      expect(d.amount.toString()).to.equal((25n * USDC).toString());
    });

    it("rejects initialize_token_deal with a non-USDC mint", async () => {
      const creator = await newSigner();
      const dealId = new BN(dealCounter++);
      const deal = await dealPDA(creator.address, dealId);
      const vault = await ataOf(deal, fakeMint);
      await expectFailure(
        initTokenDealIx(creator, deal, fakeMint, vault, tokenDealArgs(dealId)),
        creator,
        "InvalidMint"
      );
    });

    it("full USDC flow pays worker 98% and treasury 2%, creating ATAs and closing vault", async () => {
      const treasuryAta = await ataOf(TREASURY, USDC_MINT);
      expect(accountExists(treasuryAta)).to.equal(false);

      const runFlow = async (amount: bigint) => {
        const creator = await newSigner();
        const worker = await newSigner(1n);
        await giveUsdc(creator, amount);
        const { deal, vault } = await createTokenDeal(creator, true, { amount: new BN(amount.toString()) });
        await sendIx(submitWorkIx(worker, deal, "https://github.com/x/usdc"), worker);
        const workerAta = await ataOf(worker.address, USDC_MINT);
        expect(accountExists(workerAta)).to.equal(false);
        const tBefore = tokenBalance(treasuryAta);
        await sendIx(await approveTokenDealIx(creator, deal, worker.address), creator);
        const paid = { worker: tokenBalance(workerAta), fee: tokenBalance(treasuryAta) - tBefore };
        expect(accountExists(vault)).to.equal(false);
        expect(statusName(fetchDeal(deal).status)).to.equal("completed");
        return paid;
      };

      const p1 = await runFlow(25n * USDC);
      expect(p1.worker).to.equal(24_500_000n);
      expect(p1.fee).to.equal(500_000n);
      expect(accountExists(treasuryAta)).to.equal(true);

      const p2 = await runFlow(1_234_567n);
      expect(p2.fee).to.equal(24_691n);
      expect(p2.worker).to.equal(1_209_876n);
      oddPaid = p2;
    });

    it("cancel_token_deal: created anytime, funded only after deadline, submitted never", async () => {
      const c1 = await newSigner();
      const created = await createTokenDeal(c1, false);
      await sendIx(await cancelTokenDealIx(c1, created.deal), c1);
      expect(statusName(fetchDeal(created.deal).status)).to.equal("cancelled");
      expect(accountExists(created.vault)).to.equal(false);

      const c2 = await newSigner();
      await giveUsdc(c2, 25n * USDC);
      const funded = await createTokenDeal(c2, true);
      expect(tokenBalance(funded.creatorAta)).to.equal(0n);
      await expectFailure(await cancelTokenDealIx(c2, funded.deal), c2, "DeadlineNotPassed");
      setTime(nowTs + 3601n);
      await sendIx(await cancelTokenDealIx(c2, funded.deal), c2);
      expect(tokenBalance(funded.creatorAta)).to.equal(25n * USDC);
      expect(accountExists(funded.vault)).to.equal(false);
      expect(statusName(fetchDeal(funded.deal).status)).to.equal("cancelled");

      setTime(nowTs);
      const c3 = await newSigner();
      const worker = await newSigner(1n);
      await giveUsdc(c3, 25n * USDC);
      const sub = await createTokenDeal(c3, true);
      await sendIx(submitWorkIx(worker, sub.deal, "done"), worker);
      setTime(nowTs + 7200n);
      await expectFailure(await cancelTokenDealIx(c3, sub.deal), c3, "InvalidStatus");
    });

    it("approve_token_deal rejects wrong worker and wrong treasury", async () => {
      const creator = await newSigner();
      const worker = await newSigner(1n);
      const other = await newSigner(1n);
      await giveUsdc(creator, 25n * USDC);
      const { deal } = await createTokenDeal(creator, true);
      await sendIx(submitWorkIx(worker, deal, "done"), worker);
      await expectFailure(await approveTokenDealIx(creator, deal, other.address), creator, "WorkerMismatch");
      await expectFailure(
        await approveTokenDealIx(creator, deal, worker.address, other.address),
        creator,
        "InvalidTreasury"
      );
    });

    it("cross-currency instructions fail with CurrencyMismatch", async () => {
      const creator = await newSigner();
      const worker = await newSigner(1n);
      await giveUsdc(creator, 25n * USDC);
      const usdcDeal = await createTokenDeal(creator, true);
      await expectFailure(fundDealIx(creator, usdcDeal.deal), creator, "CurrencyMismatch");
      await expectFailure(approveDealIx(creator, usdcDeal.deal, worker.address), creator, "CurrencyMismatch");
      await expectFailure(cancelDealIx(creator, usdcDeal.deal), creator, "CurrencyMismatch");

      const { deal: solDeal } = await createDeal(creator);
      const solVault = await ataOf(solDeal, USDC_MINT);
      await sendIxs([createAtaIx(creator, solVault, solDeal, USDC_MINT)], creator);
      await expectFailure(
        fundTokenDealIx(creator, solDeal, usdcDeal.creatorAta, solVault),
        creator,
        "CurrencyMismatch"
      );
      await expectFailure(await cancelTokenDealIx(creator, solDeal), creator, "CurrencyMismatch");
    });

    it("old-layout Deal accounts (no mint field) still cancel and decode with mint = null", async () => {
      const creator = await newSigner();
      const dealId = new BN(dealCounter++);
      const [pda, bump] = await getProgramDerivedAddress({
        programAddress,
        seeds: [
          new TextEncoder().encode("deal"),
          addressCodec.encode(creator.address),
          dealId.toArrayLike(Buffer, "le", 8),
        ],
      });
      const disc = (idl as any).accounts.find((a: any) => a.name === "Deal").discriminator;
      const enc = new TextEncoder();
      const str = (s: string) => {
        const b = enc.encode(s);
        const len = new Uint8Array(4);
        new DataView(len.buffer).setUint32(0, b.length, true);
        return concat([len, b]);
      };
      const OLD_SIZE = 8 + 631;
      const body = concat([
        Uint8Array.from(disc),
        u64le(BigInt(dealId.toString())),
        addressCodec.encode(creator.address) as any,
        new Uint8Array([0]),
        u64le(ONE_SOL),
        new Uint8Array([1]),
        i64le(nowTs - 100n),
        i64le(nowTs - 1000n),
        str("Legacy deal"),
        str("Created before USDC support"),
        str(""),
        new Uint8Array([bump]),
      ]);
      const data = new Uint8Array(OLD_SIZE);
      data.set(body, 0);
      setRawAccount(pda, programAddress, data, rentFor(OLD_SIZE) + ONE_SOL);

      let d = fetchDeal(pda);
      expect(d.mint).to.equal(null);
      expect(statusName(d.status)).to.equal("funded");
      expect(d.bump).to.equal(bump);

      const cBefore = balanceOf(creator.address);
      const dBefore = balanceOf(pda);
      await sendIx(cancelDealIx(creator, pda), creator);
      expect(dBefore - balanceOf(pda)).to.equal(ONE_SOL);
      expect(balanceOf(creator.address) > cBefore).to.equal(true);
      d = fetchDeal(pda);
      expect(statusName(d.status)).to.equal("cancelled");
      expect(d.mint).to.equal(null);
      expect((svm.getAccount(pda) as any).data.length).to.equal(OLD_SIZE);
    });

    describe("price conversion (src/lib/priceMath)", () => {
      const FEED_HEX = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

      function buildPriceUpdate(level: number[], price: bigint, conf: bigint, expo: number, publishTime: bigint) {
        const feed = new Uint8Array(32);
        for (let i = 0; i < 32; i++) feed[i] = parseInt(FEED_HEX.slice(i * 2, i * 2 + 2), 16);
        const expoB = new Uint8Array(4);
        new DataView(expoB.buffer).setInt32(0, expo, true);
        return concat([
          new Uint8Array(8).fill(9),
          new Uint8Array(32).fill(7),
          new Uint8Array(level),
          feed,
          i64le(price),
          u64le(conf),
          expoB,
          i64le(publishTime),
          i64le(publishTime - 1n),
          i64le(price),
          u64le(conf),
          u64le(123n),
        ]);
      }

      it("converts USD to base units", () => {
        expect(priceMath.usdToLamports(100, 200)).to.equal(500_000_000n);
        expect(priceMath.usdToLamports(1, 3)).to.equal(333_333_333n);
        expect(priceMath.usdToUsdcUnits(25)).to.equal(25_000_000n);
        expect(priceMath.usdToUsdcUnits(0.1 + 0.2)).to.equal(300_000n);
        expect(() => priceMath.usdToBaseUnits(10, "SOL", null)).to.throw();
        expect(priceMath.usdToBaseUnits(25, "USDC", null)).to.equal(25_000_000n);
        expect(() => priceMath.usdToLamports(1, 0)).to.throw();
        expect(() => priceMath.usdToLamports(1, -5)).to.throw();
        expect(() => priceMath.usdToLamports(0, 100)).to.throw();
        expect(() => priceMath.usdToLamports(-1, 100)).to.throw();
      });

      it("converts base units to USD", () => {
        expect(priceMath.baseUnitsToUsd(25_000_000n, "USDC", null)).to.equal(25);
        expect(priceMath.baseUnitsToUsd(500_000_000n, "SOL", 200)).to.equal(100);
        expect(priceMath.baseUnitsToUsd(500_000_000n, "SOL", null)).to.equal(null);
      });

      it("computeFeeSplit mirrors the on-chain split", () => {
        const s = priceMath.computeFeeSplit(1_234_567n);
        expect(s.fee).to.equal(24_691n);
        expect(s.worker).to.equal(1_209_876n);
        expect(oddPaid).to.not.equal(null);
        expect(oddPaid!.fee).to.equal(s.fee);
        expect(oddPaid!.worker).to.equal(s.worker);
      });

      it("decodes PriceUpdateV2 (Full and Partial) and checks usability", () => {
        const publishTime = 1_700_000_000n;
        const full = priceMath.decodePriceUpdateV2(buildPriceUpdate([1], 15_123_456_789n, 5_000_000n, -8, publishTime));
        expect(full.price).to.be.closeTo(151.23456789, 1e-9);
        expect(full.conf).to.be.closeTo(0.05, 1e-12);
        expect(full.expo).to.equal(-8);
        expect(full.feedIdHex).to.equal(FEED_HEX);
        expect(full.publishTime).to.equal(Number(publishTime));

        const partial = priceMath.decodePriceUpdateV2(
          buildPriceUpdate([0, 5], 15_123_456_789n, 5_000_000n, -8, publishTime)
        );
        expect(partial).to.deep.equal(full);

        const now = Number(publishTime) + 10;
        expect(priceMath.isPriceUsable(full, now)).to.equal(true);
        expect(priceMath.isPriceUsable(full, Number(publishTime) + 121)).to.equal(false);
        expect(priceMath.isPriceUsable({ price: 151, conf: 4, publishTime: now }, now)).to.equal(false);
      });
    });

    describe("frontend Deal codec (src/lib/dealCodec)", () => {
      const REAL_DEAL = "65wHSwtHHWff7FoG7sWvZxtixsJDKQ9wmnTvhCZCJ1nQ";

      // NB: the on-chain title really is "Page Redising" (typo made at creation time)
      it("decodes the live devnet deal 65wHSw…J1nQ (\"Page Redising\", 672 bytes)", async function () {
        this.timeout(30_000);
        const res = await fetch("https://api.devnet.solana.com", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAccountInfo",
            params: [REAL_DEAL, { encoding: "base64", commitment: "confirmed" }],
          }),
        });
        const json: any = await res.json();
        const value = json?.result?.value;
        expect(value, "account must exist on devnet").to.not.equal(null);
        expect(value.owner).to.equal(programAddress);
        const data = new Uint8Array(Buffer.from(value.data[0], "base64"));
        expect(data.length).to.equal(DEAL_ACCOUNT_SIZE);

        const d = decodeDealAccount(data);
        expect(d.title).to.equal("Page Redising");
        expect(d.mint).to.equal(null);
        expect(d.amount > 0n).to.equal(true);
        expect(BigInt(value.lamports) > d.amount).to.equal(true);
        expect(["created", "funded", "submitted", "completed", "cancelled"]).to.include(d.status);

        // Must agree with Anchor's coder on every field
        const viaAnchor: any = coder.accounts.decode("Deal", Buffer.from(data));
        expect(viaAnchor.title).to.equal(d.title);
        expect(viaAnchor.description).to.equal(d.description);
        expect(viaAnchor.amount.toString()).to.equal(d.amount.toString());
        // deal_id is the client's Date.now() at creation; must sit within 5 min of created_at.
        // (Anchor's BN.toString() for this u64 yields '1790610000NaN' in this env, so don't compare via BN.)
        const idMs = Number(d.dealId);
        const createdMs = Number(d.createdAt) * 1000;
        expect(Math.abs(idMs - createdMs) < 5 * 60_000, `dealId ${idMs} vs createdAt ${createdMs}`).to.equal(true);
        expect(toAddressString(viaAnchor.creator)).to.equal(addressCodec.decode(d.creator));
        expect(viaAnchor.bump).to.equal(d.bump);
      });

      it("decodes an in-SVM deal identically to the Anchor coder and rejects bad data", async () => {
        const creator = await newSigner();
        const { deal } = await createDeal(creator);
        const raw = new Uint8Array((svm.getAccount(deal) as any).data);
        expect(raw.length).to.equal(DEAL_ACCOUNT_SIZE);
        const d = decodeDealAccount(raw);
        const a: any = fetchDeal(deal);
        expect(d.title).to.equal(a.title);
        expect(statusName(a.status)).to.equal(d.status);
        expect(d.mint).to.equal(null);
        expect(() => decodeDealAccount(raw.subarray(0, 100))).to.throw(/truncated/);
        const bad = raw.slice();
        bad[0] ^= 0xff;
        expect(() => decodeDealAccount(bad)).to.throw(/discriminator/);
      });
    });
  });
});
