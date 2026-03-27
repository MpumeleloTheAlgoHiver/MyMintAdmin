import React, { useEffect, useState } from 'react';
import AdminApprovalService from '../services/AdminApprovalService';
import './AdminApprovalDashboard.css';

const AdminApprovalDashboard = () => {
    const [pending, setPending] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedApproval, setSelectedApproval] = useState(null);
    const [activeTab, setActiveTab] = useState('review'); // review, approve, reject, pay
    const [templates, setTemplates] = useState([]);
    const [formData, setFormData] = useState({
        interestRate: 12.5,
        tenureMonths: 24,
        adminNotes: '',
        rejectionReason: ''
    });

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const [pendingData, templateData] = await Promise.all([
                    AdminApprovalService.getPendingApprovals(),
                    AdminApprovalService.getTemplates()
                ]);
                setPending(pendingData);
                setTemplates(templateData);
            } catch (err) {
                console.error('Failed to load dashboard data:', err);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    const handleSelect = (approval) => {
        setSelectedApproval(approval);
        setActiveTab('review');
        // Pre-fill with default template if available
        const defaultTemplate = templates.find(t => t.is_default);
        if (defaultTemplate) {
            setFormData({
                ...formData,
                interestRate: defaultTemplate.interest_rate_min,
                tenureMonths: defaultTemplate.max_tenure,
                adminNotes: `Standard terms applied from ${defaultTemplate.name} template.`
            });
        }
    };

    const handleApprove = async () => {
        try {
            await AdminApprovalService.approveApplication(selectedApproval.id, {
                interestRate: formData.interestRate,
                tenureMonths: formData.tenureMonths,
                adminNotes: formData.adminNotes
            });
            alert('Application Approved Successfully');
            refreshList();
        } catch (err) {
            alert('Approval failed: ' + err.message);
        }
    };

    const handleReject = async () => {
        try {
            await AdminApprovalService.rejectApplication(selectedApproval.id, formData.rejectionReason);
            alert('Application Rejected');
            refreshList();
        } catch (err) {
            alert('Rejection failed: ' + err.message);
        }
    };

    const handlePayment = async () => {
        try {
            await AdminApprovalService.initiatePayment(selectedApproval.id);
            alert('EFT Payment Initiated');
            refreshList();
        } catch (err) {
            alert('Payment failed: ' + err.message);
        }
    };

    const refreshList = async () => {
        setSelectedApproval(null);
        const data = await AdminApprovalService.getPendingApprovals();
        setPending(data);
    };

    if (loading) return <div className="admin-loader">Loading Admin Dashboard...</div>;

    return (
        <div className="admin-container">
            <header className="admin-header">
                <div className="admin-header-left">
                    <h1>Loan Approvals</h1>
                    <p>{pending.length} Applications Pending Review</p>
                </div>
                <div className="admin-stats">
                    <div className="stat-card">
                        <span className="stat-value">{pending.length}</span>
                        <span className="stat-label">Pending</span>
                    </div>
                </div>
            </header>

            <div className="admin-layout">
                {/* List View */}
                <div className="admin-sidebar-list">
                    {pending.length === 0 ? (
                        <div className="empty-state">No pending applications found.</div>
                    ) : (
                        pending.map(app => (
                            <div 
                                key={app.id} 
                                className={`approval-card ${selectedApproval?.id === app.id ? 'active' : ''}`}
                                onClick={() => handleSelect(app)}
                            >
                                <div className="card-header">
                                    <span className="client-name">{app.profile?.first_name} {app.profile?.last_name}</span>
                                    <span className="amount">R {parseFloat(app.amount).toLocaleString()}</span>
                                </div>
                                <div className="card-footer">
                                    <span className="date">{new Date(app.created_at).toLocaleDateString()}</span>
                                    <span className="status-badge">Pending</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Detail View */}
                <div className="admin-main-detail">
                    {selectedApproval ? (
                        <div className="detail-panel">
                            <div className="detail-header">
                                <h2>Application Details</h2>
                                <div className="tab-switcher">
                                    <button onClick={() => setActiveTab('review')} className={activeTab === 'review' ? 'active' : ''}>Review</button>
                                    <button onClick={() => setActiveTab('approve')} className={activeTab === 'approve' ? 'active' : ''}>Approve</button>
                                    <button onClick={() => setActiveTab('reject')} className={activeTab === 'reject' ? 'active' : ''}>Reject</button>
                                    <button onClick={() => setActiveTab('pay')} className={activeTab === 'pay' ? 'active' : ''}>Payment</button>
                                </div>
                            </div>

                            <div className="detail-content">
                                {activeTab === 'review' && (
                                    <div className="review-tab">
                                        <section className="info-section">
                                            <h3>Customer Profile</h3>
                                            <div className="info-grid">
                                                <div className="info-item"><label>Name</label><span>{selectedApproval.profile?.first_name} {selectedApproval.profile?.last_name}</span></div>
                                                <div className="info-item"><label>Email</label><span>{selectedApproval.profile?.email}</span></div>
                                                <div className="info-item"><label>ID Number</label><span>{selectedApproval.profile?.id_number || 'N/A'}</span></div>
                                            </div>
                                        </section>
                                        <section className="info-section">
                                            <h3>Loan Details</h3>
                                            <div className="info-grid">
                                                <div className="info-item"><label>Requested Amount</label><span className="bold-zar">R {parseFloat(selectedApproval.amount).toLocaleString()}</span></div>
                                                <div className="info-item"><label>Payout Method</label><span>{selectedApproval.payout_method}</span></div>
                                                <div className="info-item"><label>Created At</label><span>{new Date(selectedApproval.created_at).toLocaleString()}</span></div>
                                            </div>
                                            <div className="admin-notes-box">
                                                <label>Admin Notes</label>
                                                <p>{selectedApproval.admin_notes || 'No notes provided.'}</p>
                                            </div>
                                        </section>Section Content
                                    </div>
                                )}

                                {activeTab === 'approve' && (
                                    <div className="approve-tab">
                                        <div className="approval-form">
                                            <div className="form-group">
                                                <label>Annual Interest Rate (%)</label>
                                                <input 
                                                    type="number" 
                                                    value={formData.interestRate}
                                                    onChange={(e) => setFormData({...formData, interestRate: e.target.value})}
                                                    step="0.1"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Tenure (Months)</label>
                                                <select 
                                                    value={formData.tenureMonths}
                                                    onChange={(e) => setFormData({...formData, tenureMonths: e.target.value})}
                                                >
                                                    <option value={12}>12 Months</option>
                                                    <option value={24}>24 Months</option>
                                                    <option value={36}>36 Months</option>
                                                    <option value={48}>48 Months</option>
                                                </select>
                                            </div>
                                            <div className="form-group">
                                                <label>Approval Notes (Internal)</label>
                                                <textarea 
                                                    value={formData.adminNotes}
                                                    onChange={(e) => setFormData({...formData, adminNotes: e.target.value})}
                                                    placeholder="Add internal notes about this approval..."
                                                />
                                            </div>
                                            <button className="btn-approve" onClick={handleApprove}>Confirm Approval</button>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'reject' && (
                                    <div className="reject-tab">
                                        <div className="rejection-form">
                                            <label>Reason for Rejection</label>
                                            <textarea 
                                                value={formData.rejectionReason}
                                                onChange={(e) => setFormData({...formData, rejectionReason: e.target.value})}
                                                placeholder="Explain why the application was rejected (this will be sent to the user)..."
                                            />
                                            <button className="btn-reject" onClick={handleReject}>Reject Application</button>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'pay' && (
                                    <div className="pay-tab">
                                        <div className="payout-summary">
                                            <div className="summary-card">
                                                <label>Payout Amount</label>
                                                <span className="amount">R {parseFloat(selectedApproval.amount).toLocaleString()}</span>
                                            </div>
                                            <p className="warning-text">⚠️ Ensure the user's bank account details have been verified before initiating payment.</p>
                                            <button className="btn-pay" onClick={handlePayment}>Release Funds via EFT</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="no-selection">
                            <div className="selection-graphic">🔍</div>
                            <h3>Select an application to review</h3>
                            <p>Choose one of the {pending.length} pending requests from the left to start the approval workflow.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminApprovalDashboard;
