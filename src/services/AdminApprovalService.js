import { supabase } from '../supabaseClient';

class AdminApprovalService {
  /**
   * Creates a new pending approval record when a user completes bank verification.
   */
  async createApprovalFromVerification(loanId, verifiedAccount) {
    try {
      // 1. Fetch the loan application
      const { data: loan, error: loanErr } = await supabase
        .from('loan_application')
        .select('*')
        .eq('id', loanId)
        .single();

      if (loanErr || !loan) throw new Error('Loan application not found');

      // 2. Create the admin approval entry
      const { data: approval, error: appErr } = await supabase
        .from('admin_approvals')
        .insert({
          user_id: loan.user_id,
          loan_application_id: loan.id,
          amount: loan.principal_amount,
          status: 'pending',
          admin_notes: `Bank verified: ${verifiedAccount.bankName} (${verifiedAccount.accountNumber})`,
        })
        .select()
        .single();

      if (appErr) throw appErr;

      // 3. Log the audit event
      await this.logAudit(approval.id, 'create', { 
        loanId, 
        bank: verifiedAccount.bankName, 
        amount: loan.principal_amount 
      });

      return { success: true, approvalId: approval.id };
    } catch (err) {
      console.error('[AdminApprovalService] createApprovalFromVerification error:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Retrieves a list of pending approvals for the dashboard.
   */
  async getPendingApprovals() {
    const { data, error } = await supabase
      .from('admin_approvals')
      .select(`
        *,
        loan:loan_application_id (*),
        profile:user_id (first_name, last_name, email)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  /**
   * Approves an application and sets the terms.
   */
  async approveApplication(approvalId, terms) {
    const { interestRate, tenureMonths, adminNotes } = terms;

    const { data, error } = await supabase
      .from('admin_approvals')
      .update({
        status: 'approved',
        interest_rate: interestRate,
        tenure_months: tenureMonths,
        admin_notes: adminNotes,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', approvalId)
      .select()
      .single();

    if (error) throw error;

    await this.logAudit(approvalId, 'approve', { interestRate, tenureMonths });
    return data;
  }

  /**
   * Rejects an application with a reason.
   */
  async rejectApplication(approvalId, reason) {
    const { data, error } = await supabase
      .from('admin_approvals')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', approvalId)
      .select()
      .single();

    if (error) throw error;

    await this.logAudit(approvalId, 'reject', { reason });
    return data;
  }

  /**
   * Initiates payment for an approved application.
   */
  async initiatePayment(approvalId) {
    // 1. Mark as processing
    await supabase
      .from('admin_approvals')
      .update({ status: 'processing' })
      .eq('id', approvalId);

    try {
      // 2. Call the disbursement API (placeholder for actual EFT/Stripe call)
      const response = await fetch('/api/admin/payouts/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalId })
      });

      if (!response.ok) throw new Error('Payout initiation failed');

      // 3. Mark as completed (or wait for webhook if async)
      const { data, error } = await supabase
        .from('admin_approvals')
        .update({
          status: 'completed',
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', approvalId);

      if (error) throw error;

      await this.logAudit(approvalId, 'pay', { method: 'EFT' });
      return { success: true };
    } catch (err) {
      // Rollback to approved if payout fails
      await supabase
        .from('admin_approvals')
        .update({ status: 'approved' })
        .eq('id', approvalId);
      
      throw err;
    }
  }

  /**
   * Logs an action in the audit trail.
   */
  async logAudit(approvalId, action, details) {
    await supabase.from('approval_audit_log').insert({
      approval_id: approvalId,
      action,
      details
    });
  }

  /**
   * Fetches available approval templates.
   */
  async getTemplates() {
    const { data, error } = await supabase
      .from('approval_templates')
      .select('*')
      .order('name');

    if (error) throw error;
    return data;
  }
}

export default new AdminApprovalService();
