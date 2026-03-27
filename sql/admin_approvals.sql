-- Add Admin Approval System Tables
CREATE TABLE IF NOT EXISTS admin_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) NOT NULL,
    loan_application_id UUID REFERENCES loan_application(id) NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, approved, rejected, processing, completed
    interest_rate NUMERIC,
    tenure_months INTEGER,
    amount NUMERIC NOT NULL,
    payout_method TEXT DEFAULT 'EFT',
    rejection_reason TEXT,
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    signed_agreement_url TEXT
);

CREATE TABLE IF NOT EXISTS approval_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    approval_id UUID REFERENCES admin_approvals(id) ON DELETE CASCADE,
    admin_id UUID, 
    action TEXT NOT NULL, -- create, approve, reject, pay, update_status
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    interest_rate_min NUMERIC,
    interest_rate_max NUMERIC,
    max_tenure INTEGER,
    min_amount NUMERIC,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial templates
INSERT INTO approval_templates (name, interest_rate_min, interest_rate_max, max_tenure, min_amount, is_default)
VALUES 
('Standard Payout', 12.5, 15.0, 24, 1000, true),
('Low Risk / High LTV', 8.0, 11.5, 48, 5000, false),
('Conservative / Short Term', 18.0, 25.0, 12, 500, false)
ON CONFLICT DO NOTHING;
