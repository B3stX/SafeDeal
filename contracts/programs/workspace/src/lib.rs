use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{
    close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked,
};

declare_id!("CHccTzEfLfK8j4oNfkPnABrTfZbeLoQY5cKkx5r5iobZ");

pub const TREASURY: Pubkey = pubkey!("BtxpihJkeuj5MdtYoRWfRC2VJQfxTg4Fwht44mQp7Sk");
pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const PLATFORM_FEE_BPS: u64 = 200;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_TITLE_LEN: usize = 64;
pub const MAX_DESCRIPTION_LEN: usize = 256;
pub const MAX_SUBMISSION_LEN: usize = 200;

fn move_lamports_out(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let from_balance = from
        .lamports()
        .checked_sub(amount)
        .ok_or(ErrorCode::InsufficientFunds)?;
    let min_rent = Rent::get()?.minimum_balance(from.data_len());
    require!(from_balance >= min_rent, ErrorCode::InsufficientFunds);
    let to_balance = to
        .lamports()
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;
    **from.try_borrow_mut_lamports()? = from_balance;
    **to.try_borrow_mut_lamports()? = to_balance;
    Ok(())
}

fn validate_deal_params(
    creator_key: &Pubkey,
    title: &str,
    description: &str,
    amount: u64,
    deadline: i64,
    worker: &Option<Pubkey>,
    now: i64,
) -> Result<()> {
    require!(!title.is_empty(), ErrorCode::TitleEmpty);
    require!(title.len() <= MAX_TITLE_LEN, ErrorCode::TitleTooLong);
    require!(!description.is_empty(), ErrorCode::DescriptionEmpty);
    require!(
        description.len() <= MAX_DESCRIPTION_LEN,
        ErrorCode::DescriptionTooLong
    );
    require!(amount > 0, ErrorCode::InvalidAmount);
    require!(deadline > now, ErrorCode::InvalidDeadline);
    if let Some(w) = worker {
        require!(w != creator_key, ErrorCode::WorkerIsCreator);
    }
    Ok(())
}

fn compute_fee_split(amount: u64) -> Result<(u64, u64)> {
    let fee = amount
        .checked_mul(PLATFORM_FEE_BPS)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ErrorCode::MathOverflow)?;
    let worker_amount = amount.checked_sub(fee).ok_or(ErrorCode::MathOverflow)?;
    Ok((fee, worker_amount))
}

#[allow(clippy::too_many_arguments)]
fn vault_transfer<'info>(
    token_program: AccountInfo<'info>,
    vault: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: vault,
                mint,
                to,
                authority,
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )
}

fn close_vault<'info>(
    token_program: AccountInfo<'info>,
    vault: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    close_account(CpiContext::new_with_signer(
        token_program,
        CloseAccount {
            account: vault,
            destination,
            authority,
        },
        signer_seeds,
    ))
}

#[program]
pub mod workspace {
    use super::*;

    pub fn initialize_deal(
        ctx: Context<InitializeDeal>,
        deal_id: u64,
        title: String,
        description: String,
        amount: u64,
        deadline: i64,
        worker: Option<Pubkey>,
    ) -> Result<()> {
        let creator_key = ctx.accounts.creator.key();
        let now = Clock::get()?.unix_timestamp;
        validate_deal_params(&creator_key, &title, &description, amount, deadline, &worker, now)?;

        let deal = &mut ctx.accounts.deal;
        deal.deal_id = deal_id;
        deal.creator = creator_key;
        deal.worker = worker;
        deal.amount = amount;
        deal.status = DealStatus::Created;
        deal.deadline = deadline;
        deal.created_at = now;
        deal.title = title;
        deal.description = description;
        deal.submission = String::new();
        deal.bump = ctx.bumps.deal;
        deal.mint = None;

        emit!(DealCreated {
            deal: deal.key(),
            creator: creator_key,
            deal_id,
            amount,
            deadline,
            worker,
        });
        Ok(())
    }

    pub fn fund_deal(ctx: Context<FundDeal>) -> Result<()> {
        let amount = ctx.accounts.deal.amount;
        require!(
            ctx.accounts.deal.status == DealStatus::Created,
            ErrorCode::InvalidStatus
        );

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.deal.to_account_info(),
                },
            ),
            amount,
        )?;

        let deal = &mut ctx.accounts.deal;
        deal.status = DealStatus::Funded;

        emit!(DealFunded {
            deal: deal.key(),
            creator: deal.creator,
            amount,
        });
        Ok(())
    }

    pub fn submit_work(ctx: Context<SubmitWork>, submission: String) -> Result<()> {
        let worker_key = ctx.accounts.worker.key();
        let now = Clock::get()?.unix_timestamp;
        let deal = &mut ctx.accounts.deal;

        require!(deal.status == DealStatus::Funded, ErrorCode::InvalidStatus);
        require!(now <= deal.deadline, ErrorCode::DeadlinePassed);
        require!(
            submission.len() <= MAX_SUBMISSION_LEN,
            ErrorCode::SubmissionTooLong
        );

        match deal.worker {
            Some(w) => require!(w == worker_key, ErrorCode::UnauthorizedWorker),
            None => {
                require!(worker_key != deal.creator, ErrorCode::CreatorCannotSubmit);
                deal.worker = Some(worker_key);
            }
        }

        deal.submission = submission;
        deal.status = DealStatus::Submitted;

        emit!(WorkSubmitted {
            deal: deal.key(),
            worker: worker_key,
        });
        Ok(())
    }

    pub fn approve_deal(ctx: Context<ApproveDeal>) -> Result<()> {
        let amount = ctx.accounts.deal.amount;
        require!(
            ctx.accounts.deal.status == DealStatus::Submitted,
            ErrorCode::InvalidStatus
        );

        let (fee, worker_amount) = compute_fee_split(amount)?;

        let deal_info = ctx.accounts.deal.to_account_info();
        move_lamports_out(
            &deal_info,
            &ctx.accounts.worker.to_account_info(),
            worker_amount,
        )?;
        move_lamports_out(&deal_info, &ctx.accounts.treasury.to_account_info(), fee)?;

        let deal = &mut ctx.accounts.deal;
        deal.status = DealStatus::Completed;

        emit!(DealCompleted {
            deal: deal.key(),
            worker: ctx.accounts.worker.key(),
            worker_amount,
            fee,
        });
        Ok(())
    }

    pub fn cancel_deal(ctx: Context<CancelDeal>) -> Result<()> {
        let status = ctx.accounts.deal.status;
        let deadline = ctx.accounts.deal.deadline;
        let amount = ctx.accounts.deal.amount;
        let now = Clock::get()?.unix_timestamp;

        let refunded = match status {
            DealStatus::Created => 0,
            DealStatus::Funded => {
                require!(now > deadline, ErrorCode::DeadlineNotPassed);
                move_lamports_out(
                    &ctx.accounts.deal.to_account_info(),
                    &ctx.accounts.creator.to_account_info(),
                    amount,
                )?;
                amount
            }
            _ => return err!(ErrorCode::InvalidStatus),
        };

        let deal = &mut ctx.accounts.deal;
        deal.status = DealStatus::Cancelled;

        emit!(DealCancelled {
            deal: deal.key(),
            creator: deal.creator,
            refunded,
        });
        Ok(())
    }

    pub fn initialize_token_deal(
        ctx: Context<InitializeTokenDeal>,
        deal_id: u64,
        title: String,
        description: String,
        amount: u64,
        deadline: i64,
        worker: Option<Pubkey>,
    ) -> Result<()> {
        let creator_key = ctx.accounts.creator.key();
        let mint_key = ctx.accounts.mint.key();
        let deal_key = ctx.accounts.deal.key();
        let now = Clock::get()?.unix_timestamp;
        validate_deal_params(&creator_key, &title, &description, amount, deadline, &worker, now)?;

        let deal = &mut ctx.accounts.deal;
        deal.deal_id = deal_id;
        deal.creator = creator_key;
        deal.worker = worker;
        deal.amount = amount;
        deal.status = DealStatus::Created;
        deal.deadline = deadline;
        deal.created_at = now;
        deal.title = title;
        deal.description = description;
        deal.submission = String::new();
        deal.bump = ctx.bumps.deal;
        deal.mint = Some(mint_key);

        emit!(DealCreated {
            deal: deal_key,
            creator: creator_key,
            deal_id,
            amount,
            deadline,
            worker,
        });
        Ok(())
    }

    pub fn fund_token_deal(ctx: Context<FundTokenDeal>) -> Result<()> {
        let amount = ctx.accounts.deal.amount;
        let decimals = ctx.accounts.mint.decimals;
        let deal_key = ctx.accounts.deal.key();
        let creator_key = ctx.accounts.creator.key();
        require!(
            ctx.accounts.deal.status == DealStatus::Created,
            ErrorCode::InvalidStatus
        );

        transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.escrow_vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            amount,
            decimals,
        )?;

        let deal = &mut ctx.accounts.deal;
        deal.status = DealStatus::Funded;

        emit!(DealFunded {
            deal: deal_key,
            creator: creator_key,
            amount,
        });
        Ok(())
    }

    pub fn approve_token_deal(ctx: Context<ApproveTokenDeal>) -> Result<()> {
        let amount = ctx.accounts.deal.amount;
        let decimals = ctx.accounts.mint.decimals;
        let deal_key = ctx.accounts.deal.key();
        let worker_key = ctx.accounts.worker.key();
        let creator_key = ctx.accounts.creator.key();
        let deal_id_bytes = ctx.accounts.deal.deal_id.to_le_bytes();
        let bump_arr = [ctx.accounts.deal.bump];
        require!(
            ctx.accounts.deal.status == DealStatus::Submitted,
            ErrorCode::InvalidStatus
        );

        let (fee, worker_amount) = compute_fee_split(amount)?;
        let seeds: &[&[u8]] = &[b"deal", creator_key.as_ref(), &deal_id_bytes, &bump_arr];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let token_program = ctx.accounts.token_program.to_account_info();
        let vault_info = ctx.accounts.escrow_vault.to_account_info();
        let mint_info = ctx.accounts.mint.to_account_info();
        let deal_info = ctx.accounts.deal.to_account_info();

        vault_transfer(
            token_program.clone(),
            vault_info.clone(),
            mint_info.clone(),
            ctx.accounts.worker_token_account.to_account_info(),
            deal_info.clone(),
            signer_seeds,
            worker_amount,
            decimals,
        )?;
        vault_transfer(
            token_program.clone(),
            vault_info.clone(),
            mint_info,
            ctx.accounts.treasury_token_account.to_account_info(),
            deal_info.clone(),
            signer_seeds,
            fee,
            decimals,
        )?;

        ctx.accounts.escrow_vault.reload()?;
        if ctx.accounts.escrow_vault.amount == 0 {
            close_vault(
                token_program,
                vault_info,
                ctx.accounts.creator.to_account_info(),
                deal_info,
                signer_seeds,
            )?;
        }

        let deal = &mut ctx.accounts.deal;
        deal.status = DealStatus::Completed;

        emit!(DealCompleted {
            deal: deal_key,
            worker: worker_key,
            worker_amount,
            fee,
        });
        Ok(())
    }

    pub fn cancel_token_deal(ctx: Context<CancelTokenDeal>) -> Result<()> {
        let status = ctx.accounts.deal.status;
        let deadline = ctx.accounts.deal.deadline;
        let decimals = ctx.accounts.mint.decimals;
        let deal_key = ctx.accounts.deal.key();
        let creator_key = ctx.accounts.creator.key();
        let deal_id_bytes = ctx.accounts.deal.deal_id.to_le_bytes();
        let bump_arr = [ctx.accounts.deal.bump];
        let refunded = ctx.accounts.escrow_vault.amount;
        let now = Clock::get()?.unix_timestamp;

        match status {
            DealStatus::Created => {}
            DealStatus::Funded => require!(now > deadline, ErrorCode::DeadlineNotPassed),
            _ => return err!(ErrorCode::InvalidStatus),
        }

        let seeds: &[&[u8]] = &[b"deal", creator_key.as_ref(), &deal_id_bytes, &bump_arr];
        let signer_seeds: &[&[&[u8]]] = &[seeds];
        let token_program = ctx.accounts.token_program.to_account_info();
        let vault_info = ctx.accounts.escrow_vault.to_account_info();
        let deal_info = ctx.accounts.deal.to_account_info();

        vault_transfer(
            token_program.clone(),
            vault_info.clone(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.creator_token_account.to_account_info(),
            deal_info.clone(),
            signer_seeds,
            refunded,
            decimals,
        )?;
        close_vault(
            token_program,
            vault_info,
            ctx.accounts.creator.to_account_info(),
            deal_info,
            signer_seeds,
        )?;

        let deal = &mut ctx.accounts.deal;
        deal.status = DealStatus::Cancelled;

        emit!(DealCancelled {
            deal: deal_key,
            creator: creator_key,
            refunded,
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(deal_id: u64)]
pub struct InitializeDeal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        seeds = [b"deal", creator.key().as_ref(), &deal_id.to_le_bytes()],
        bump,
        payer = creator,
        space = 8 + Deal::INIT_SPACE
    )]
    pub deal: Account<'info, Deal>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundDeal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", creator.key().as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = creator,
        constraint = deal.mint.is_none() @ ErrorCode::CurrencyMismatch,
    )]
    pub deal: Account<'info, Deal>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitWork<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", deal.creator.as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
    )]
    pub deal: Account<'info, Deal>,
}

#[derive(Accounts)]
pub struct ApproveDeal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", creator.key().as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = creator,
        constraint = deal.mint.is_none() @ ErrorCode::CurrencyMismatch,
    )]
    pub deal: Account<'info, Deal>,

    /// CHECK: Validated to equal the worker recorded on the deal; only receives lamports.
    #[account(
        mut,
        constraint = deal.worker == Some(worker.key()) @ ErrorCode::WorkerMismatch,
    )]
    pub worker: UncheckedAccount<'info>,

    /// CHECK: Validated against the hardcoded TREASURY address; only receives lamports.
    #[account(mut, address = TREASURY @ ErrorCode::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelDeal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", creator.key().as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = creator,
        constraint = deal.mint.is_none() @ ErrorCode::CurrencyMismatch,
    )]
    pub deal: Account<'info, Deal>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(deal_id: u64)]
pub struct InitializeTokenDeal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        seeds = [b"deal", creator.key().as_ref(), &deal_id.to_le_bytes()],
        bump,
        payer = creator,
        space = 8 + Deal::INIT_SPACE
    )]
    pub deal: Box<Account<'info, Deal>>,

    #[account(address = USDC_MINT @ ErrorCode::InvalidMint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = deal,
        associated_token::token_program = token_program,
    )]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundTokenDeal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", creator.key().as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = creator,
        constraint = deal.mint == Some(mint.key()) @ ErrorCode::CurrencyMismatch,
    )]
    pub deal: Box<Account<'info, Deal>>,

    #[account(address = USDC_MINT @ ErrorCode::InvalidMint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = deal,
    )]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ApproveTokenDeal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", creator.key().as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = creator,
        constraint = deal.mint == Some(mint.key()) @ ErrorCode::CurrencyMismatch,
    )]
    pub deal: Box<Account<'info, Deal>>,

    #[account(address = USDC_MINT @ ErrorCode::InvalidMint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = deal,
    )]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: Validated to equal the worker recorded on the deal; only used as ATA owner.
    #[account(constraint = deal.worker == Some(worker.key()) @ ErrorCode::WorkerMismatch)]
    pub worker: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = worker,
    )]
    pub worker_token_account: Box<Account<'info, TokenAccount>>,

    /// CHECK: Validated against the hardcoded TREASURY address; only used as ATA owner.
    #[account(address = TREASURY @ ErrorCode::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelTokenDeal<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"deal", creator.key().as_ref(), &deal.deal_id.to_le_bytes()],
        bump = deal.bump,
        has_one = creator,
        constraint = deal.mint == Some(mint.key()) @ ErrorCode::CurrencyMismatch,
    )]
    pub deal: Box<Account<'info, Deal>>,

    #[account(address = USDC_MINT @ ErrorCode::InvalidMint)]
    pub mint: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = deal,
    )]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DealStatus {
    Created,
    Funded,
    Submitted,
    Completed,
    Cancelled,
}

#[account]
#[derive(InitSpace)]
pub struct Deal {
    pub deal_id: u64,
    pub creator: Pubkey,
    pub worker: Option<Pubkey>,
    pub amount: u64,
    pub status: DealStatus,
    pub deadline: i64,
    pub created_at: i64,
    #[max_len(64)]
    pub title: String,
    #[max_len(256)]
    pub description: String,
    #[max_len(200)]
    pub submission: String,
    pub bump: u8,
    pub mint: Option<Pubkey>,
}

#[event]
pub struct DealCreated {
    pub deal: Pubkey,
    pub creator: Pubkey,
    pub deal_id: u64,
    pub amount: u64,
    pub deadline: i64,
    pub worker: Option<Pubkey>,
}

#[event]
pub struct DealFunded {
    pub deal: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WorkSubmitted {
    pub deal: Pubkey,
    pub worker: Pubkey,
}

#[event]
pub struct DealCompleted {
    pub deal: Pubkey,
    pub worker: Pubkey,
    pub worker_amount: u64,
    pub fee: u64,
}

#[event]
pub struct DealCancelled {
    pub deal: Pubkey,
    pub creator: Pubkey,
    pub refunded: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Title cannot be empty")]
    TitleEmpty,
    #[msg("Title exceeds 64 bytes")]
    TitleTooLong,
    #[msg("Description cannot be empty")]
    DescriptionEmpty,
    #[msg("Description exceeds 256 bytes")]
    DescriptionTooLong,
    #[msg("Submission exceeds 200 bytes")]
    SubmissionTooLong,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Deadline must be in the future")]
    InvalidDeadline,
    #[msg("Worker cannot be the creator")]
    WorkerIsCreator,
    #[msg("Deal is not in the required status")]
    InvalidStatus,
    #[msg("Deal deadline has passed")]
    DeadlinePassed,
    #[msg("Deal deadline has not passed yet")]
    DeadlineNotPassed,
    #[msg("Signer is not the assigned worker")]
    UnauthorizedWorker,
    #[msg("Creator cannot submit work on their own deal")]
    CreatorCannotSubmit,
    #[msg("Worker account does not match the deal worker")]
    WorkerMismatch,
    #[msg("Treasury account does not match the platform treasury")]
    InvalidTreasury,
    #[msg("Math overflow occurred")]
    MathOverflow,
    #[msg("Insufficient escrow funds")]
    InsufficientFunds,
    #[msg("Instruction does not match the deal currency")]
    CurrencyMismatch,
    #[msg("Only Circle devnet USDC is supported")]
    InvalidMint,
}
