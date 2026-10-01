import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import loadAllFormsWithAppointments from '@salesforce/apex/JotFormService.loadAllFormsWithAppointments';
import bulkUpdateBlockoutDates from '@salesforce/apex/JotFormService.bulkUpdateBlockoutDates';

export default class JotformBlockoutManager extends LightningElement {
    @track forms = [];
    @track isLoading = true;
    @track error;
    @track isSaving = false;

    bulkStartDate;
    bulkEndDate;

    connectedCallback() {
        this.loadForms();
    }

    async loadForms() {
        this.isLoading = true;
        this.error = undefined;
        try {
            const data = await loadAllFormsWithAppointments();
            this.forms = data
                .filter(f => f.appointments && f.appointments.length > 0)
                .map(f => ({
                    formId: f.formId,
                    formName: f.formName,
                    errorMessage: f.errorMessage,
                    selected: false,
                    expanded: false,
                    appointments: f.appointments.map(aq => ({
                        qid: aq.qid,
                        key: f.formId + '-' + aq.qid,
                        name: aq.name,
                        text: aq.text,
                        blockoutDates: (aq.blockoutDates || []).map((d, idx) => ({
                            ...d,
                            key: f.formId + '-' + aq.qid + '-' + idx,
                            label: d.startDate === d.endDate
                                ? d.startDate
                                : d.startDate + ' → ' + d.endDate
                        })),
                        newStartDate: null,
                        newEndDate: null,
                        dirty: false
                    }))
                }));
        } catch (e) {
            this.error = this.extractError(e);
        }
        this.isLoading = false;
    }

    // ── Computed properties ───────────────────────────────────

    get hasSelectedForms() {
        return this.forms.some(f => f.selected);
    }

    get allSelected() {
        return this.forms.length > 0 && this.forms.every(f => f.selected);
    }

    get selectedCount() {
        return this.forms.filter(f => f.selected).length;
    }

    get hasForms() {
        return this.forms.length > 0;
    }

    get hasNoForms() {
        return !this.isLoading && this.forms.length === 0 && !this.error;
    }

    get bulkAddDisabled() {
        return !this.bulkStartDate || !this.bulkEndDate || !this.hasSelectedForms || this.isSaving;
    }

    get bulkClearDisabled() {
        return !this.hasSelectedForms || this.isSaving;
    }

    get saveDisabled() {
        return this.isSaving || !this.forms.some(f => f.appointments.some(aq => aq.dirty));
    }

    // ── Selection ─────────────────────────────────────────────

    handleSelectAll(event) {
        const checked = event.target.checked;
        this.forms = this.forms.map(f => ({ ...f, selected: checked }));
    }

    handleFormSelect(event) {
        const formId = event.currentTarget.dataset.formId;
        this.forms = this.forms.map(f =>
            f.formId === formId ? { ...f, selected: event.target.checked } : f
        );
    }

    handleToggleExpand(event) {
        const formId = event.currentTarget.dataset.formId;
        this.forms = this.forms.map(f =>
            f.formId === formId ? { ...f, expanded: !f.expanded } : f
        );
    }

    // ── Bulk actions ──────────────────────────────────────────

    handleBulkStartDate(event) {
        this.bulkStartDate = event.target.value;
    }

    handleBulkEndDate(event) {
        this.bulkEndDate = event.target.value;
    }

    handleBulkAdd() {
        if (!this.bulkStartDate || !this.bulkEndDate) return;
        if (this.bulkEndDate < this.bulkStartDate) {
            this.showToast('Error', 'End date cannot be before start date', 'error');
            return;
        }

        const newDate = {
            startDate: this.bulkStartDate,
            endDate: this.bulkEndDate
        };

        this.forms = this.forms.map(f => {
            if (!f.selected) return f;
            return {
                ...f,
                appointments: f.appointments.map(aq => {
                    const exists = aq.blockoutDates.some(
                        d => d.startDate === newDate.startDate && d.endDate === newDate.endDate
                    );
                    if (exists) return aq;

                    const updated = [...aq.blockoutDates, {
                        ...newDate,
                        key: f.formId + '-' + aq.qid + '-' + Date.now(),
                        label: newDate.startDate === newDate.endDate
                            ? newDate.startDate
                            : newDate.startDate + ' → ' + newDate.endDate
                    }];
                    return { ...aq, blockoutDates: updated, dirty: true };
                })
            };
        });

        this.bulkStartDate = null;
        this.bulkEndDate = null;
        this.showToast('Success', 'Blockout dates added to selected forms', 'success');
    }

    handleBulkClear() {
        this.forms = this.forms.map(f => {
            if (!f.selected) return f;
            return {
                ...f,
                appointments: f.appointments.map(aq => {
                    if (aq.blockoutDates.length === 0) return aq;
                    return { ...aq, blockoutDates: [], dirty: true };
                })
            };
        });
        this.showToast('Success', 'Blockout dates cleared on selected forms', 'success');
    }

    // ── Per-form actions ──────────────────────────────────────

    handlePerFormStartDate(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({ ...aq, newStartDate: event.target.value }));
    }

    handlePerFormEndDate(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({ ...aq, newEndDate: event.target.value }));
    }

    handlePerFormAdd(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => {
            if (!aq.newStartDate || !aq.newEndDate) return aq;
            if (aq.newEndDate < aq.newStartDate) {
                this.showToast('Error', 'End date cannot be before start date', 'error');
                return aq;
            }

            const exists = aq.blockoutDates.some(
                d => d.startDate === aq.newStartDate && d.endDate === aq.newEndDate
            );
            if (exists) {
                this.showToast('Info', 'This date range already exists', 'info');
                return aq;
            }

            const newDate = {
                startDate: aq.newStartDate,
                endDate: aq.newEndDate,
                key: formId + '-' + qid + '-' + Date.now(),
                label: aq.newStartDate === aq.newEndDate
                    ? aq.newStartDate
                    : aq.newStartDate + ' → ' + aq.newEndDate
            };
            return {
                ...aq,
                blockoutDates: [...aq.blockoutDates, newDate],
                newStartDate: null,
                newEndDate: null,
                dirty: true
            };
        });
    }

    handleRemoveDate(event) {
        const { formId, qid, dateKey } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({
            ...aq,
            blockoutDates: aq.blockoutDates.filter(d => d.key !== dateKey),
            dirty: true
        }));
    }

    updateAppointment(formId, qid, updater) {
        this.forms = this.forms.map(f => {
            if (f.formId !== formId) return f;
            return {
                ...f,
                appointments: f.appointments.map(aq => {
                    if (aq.qid !== qid) return aq;
                    return updater(aq);
                })
            };
        });
    }

    // ── Save ──────────────────────────────────────────────────

    async handleSave() {
        const requests = [];
        for (const form of this.forms) {
            for (const aq of form.appointments) {
                if (!aq.dirty) continue;
                requests.push({
                    formId: form.formId,
                    questionId: aq.qid,
                    dates: aq.blockoutDates.map(d => ({
                        startDate: d.startDate,
                        endDate: d.endDate
                    }))
                });
            }
        }

        if (requests.length === 0) {
            this.showToast('Info', 'No changes to save', 'info');
            return;
        }

        this.isSaving = true;
        try {
            const results = await bulkUpdateBlockoutDates({
                requestsJson: JSON.stringify(requests)
            });

            let successCount = 0;
            let failCount = 0;
            const errors = [];

            for (const r of results) {
                if (r.success) {
                    successCount++;
                    this.updateAppointment(r.formId, r.questionId, aq => ({
                        ...aq, dirty: false
                    }));
                } else {
                    failCount++;
                    errors.push(r.formId + ': ' + r.errorMessage);
                }
            }

            if (failCount === 0) {
                this.showToast('Success', successCount + ' form(s) updated successfully', 'success');
            } else {
                this.showToast('Warning',
                    successCount + ' succeeded, ' + failCount + ' failed: ' + errors.join('; '),
                    'warning'
                );
            }
        } catch (e) {
            this.showToast('Error', this.extractError(e), 'error');
        }
        this.isSaving = false;
    }

    // ── Refresh ───────────────────────────────────────────────

    async handleRefresh() {
        await this.loadForms();
        this.showToast('Success', 'Forms reloaded', 'success');
    }

    // ── Utilities ─────────────────────────────────────────────

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    extractError(error) {
        if (typeof error === 'string') return error;
        if (error?.body?.message) return error.body.message;
        if (error?.message) return error.message;
        return 'Unknown error';
    }
}
