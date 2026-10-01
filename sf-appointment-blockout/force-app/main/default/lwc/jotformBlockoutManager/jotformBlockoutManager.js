import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import loadAllFormsWithAppointments from '@salesforce/apex/JotFormService.loadAllFormsWithAppointments';
import bulkUpdateAppointments from '@salesforce/apex/JotFormService.bulkUpdateAppointments';

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_OPTIONS = ALL_DAYS.map(d => ({ label: d, value: d }));
const TYPE_OPTIONS = [
    { label: 'Single', value: 'single' },
    { label: 'Group', value: 'multiple' }
];

export default class JotformBlockoutManager extends LightningElement {
    @track forms = [];
    @track isLoading = true;
    @track error;
    @track isSaving = false;

    dayOptions = DAY_OPTIONS;
    typeOptions = TYPE_OPTIONS;

    // Bulk inputs
    bulkStartDate;
    bulkEndDate;
    bulkIntervalFrom;
    bulkIntervalTo;
    bulkIntervalDays = [];

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
                .map(f => this.buildFormEntry(f));
        } catch (e) {
            this.error = this.extractError(e);
        }
        this.isLoading = false;
    }

    buildFormEntry(f) {
        return {
            formId: f.formId,
            formName: f.formName,
            errorMessage: f.errorMessage,
            selected: false,
            expanded: false,
            expandIcon: 'utility:chevronright',
            appointments: f.appointments.map(aq => this.buildAppointmentEntry(f.formId, aq))
        };
    }

    buildAppointmentEntry(formId, aq) {
        return {
            qid: aq.qid,
            key: formId + '-' + aq.qid,
            name: aq.name,
            text: aq.text,
            appointmentType: aq.appointmentType || 'single',
            slotDuration: aq.slotDuration || '',
            maxAttendee: aq.maxAttendee || '',
            rollingDays: aq.rollingDays || '',
            minScheduleNotice: aq.minScheduleNotice || '',
            isMultipleOrGroup: aq.appointmentType === 'multiple' || aq.appointmentType === 'group',
            intervals: (aq.intervals || []).map((iv, idx) => ({
                fromTime: iv.fromTime,
                toTime: iv.toTime,
                days: iv.days || [],
                key: formId + '-' + aq.qid + '-iv-' + idx
            })),
            blockoutDates: (aq.blockoutDates || []).map((d, idx) => ({
                startDate: d.startDate,
                endDate: d.endDate,
                key: formId + '-' + aq.qid + '-bd-' + idx,
                label: d.startDate === d.endDate
                    ? d.startDate
                    : d.startDate + ' → ' + d.endDate
            })),
            newStartDate: null,
            newEndDate: null,
            newIntervalFrom: null,
            newIntervalTo: null,
            newIntervalDays: [],
            dirty: false,
            dirtyFields: {}
        };
    }

    // ── Summary line for collapsed view ───────────────────────

    getSummary(aq) {
        const parts = [];
        const typeLabel = aq.appointmentType === 'multiple' ? 'Multiple' :
            aq.appointmentType === 'group' ? 'Group' : 'Single';
        parts.push(typeLabel);
        if (aq.slotDuration) parts.push(aq.slotDuration + 'min');
        if (aq.isMultipleOrGroup && aq.maxAttendee) parts.push('Cap: ' + aq.maxAttendee);
        if (aq.rollingDays) parts.push(aq.rollingDays + 'd rolling');
        return parts.join(' | ');
    }

    // ── Computed properties ───────────────────────────────────

    get hasSelectedForms() { return this.forms.some(f => f.selected); }
    get allSelected() { return this.forms.length > 0 && this.forms.every(f => f.selected); }
    get selectedCount() { return this.forms.filter(f => f.selected).length; }
    get hasForms() { return this.forms.length > 0; }
    get hasNoForms() { return !this.isLoading && this.forms.length === 0 && !this.error; }
    get bulkAddDisabled() { return !this.bulkStartDate || !this.bulkEndDate || !this.hasSelectedForms || this.isSaving; }
    get bulkClearDisabled() { return !this.hasSelectedForms || this.isSaving; }
    get bulkIntervalAddDisabled() {
        return !this.bulkIntervalFrom || !this.bulkIntervalTo || !this.bulkIntervalDays.length || !this.hasSelectedForms || this.isSaving;
    }
    get saveDisabled() { return this.isSaving || !this.forms.some(f => f.appointments.some(aq => aq.dirty)); }

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
        this.forms = this.forms.map(f => {
            if (f.formId !== formId) return f;
            const nowExpanded = !f.expanded;
            return { ...f, expanded: nowExpanded, expandIcon: nowExpanded ? 'utility:chevrondown' : 'utility:chevronright' };
        });
    }

    // ── Bulk blockout date actions ─────────────────────────────

    handleBulkStartDate(event) { this.bulkStartDate = event.target.value; }
    handleBulkEndDate(event) { this.bulkEndDate = event.target.value; }

    handleBulkAddBlockout() {
        if (!this.bulkStartDate || !this.bulkEndDate) return;
        if (this.bulkEndDate < this.bulkStartDate) {
            this.showToast('Error', 'End date cannot be before start date', 'error');
            return;
        }
        const nd = { startDate: this.bulkStartDate, endDate: this.bulkEndDate };
        this.forms = this.forms.map(f => {
            if (!f.selected) return f;
            return { ...f, appointments: f.appointments.map(aq => {
                if (aq.blockoutDates.some(d => d.startDate === nd.startDate && d.endDate === nd.endDate)) return aq;
                const updated = [...aq.blockoutDates, {
                    ...nd, key: f.formId + '-' + aq.qid + '-bd-' + Date.now(),
                    label: nd.startDate === nd.endDate ? nd.startDate : nd.startDate + ' → ' + nd.endDate
                }];
                return { ...aq, blockoutDates: updated, dirty: true, dirtyFields: { ...aq.dirtyFields, blockoutDates: true } };
            })};
        });
        this.bulkStartDate = null;
        this.bulkEndDate = null;
        this.showToast('Success', 'Blockout dates added to selected forms', 'success');
    }

    handleBulkClearBlockout() {
        this.forms = this.forms.map(f => {
            if (!f.selected) return f;
            return { ...f, appointments: f.appointments.map(aq => {
                if (aq.blockoutDates.length === 0) return aq;
                return { ...aq, blockoutDates: [], dirty: true, dirtyFields: { ...aq.dirtyFields, blockoutDates: true } };
            })};
        });
        this.showToast('Success', 'Blockout dates cleared on selected forms', 'success');
    }

    // ── Bulk interval actions ─────────────────────────────────

    handleBulkIntervalFrom(event) { this.bulkIntervalFrom = event.target.value; }
    handleBulkIntervalTo(event) { this.bulkIntervalTo = event.target.value; }
    handleBulkIntervalDays(event) { this.bulkIntervalDays = event.detail.value; }

    handleBulkAddInterval() {
        if (!this.bulkIntervalFrom || !this.bulkIntervalTo || !this.bulkIntervalDays.length) return;
        const newIv = { fromTime: this.bulkIntervalFrom, toTime: this.bulkIntervalTo, days: [...this.bulkIntervalDays] };
        this.forms = this.forms.map(f => {
            if (!f.selected) return f;
            return { ...f, appointments: f.appointments.map(aq => {
                const updated = [...aq.intervals, { ...newIv, key: f.formId + '-' + aq.qid + '-iv-' + Date.now() }];
                return { ...aq, intervals: updated, dirty: true, dirtyFields: { ...aq.dirtyFields, intervals: true } };
            })};
        });
        this.bulkIntervalFrom = null;
        this.bulkIntervalTo = null;
        this.bulkIntervalDays = [];
        this.showToast('Success', 'Interval added to selected forms', 'success');
    }

    // ── Per-form settings ─────────────────────────────────────

    handleSettingChange(event) {
        const { formId, qid, field } = event.currentTarget.dataset;
        const value = event.target.value || event.detail.value;
        this.updateAppointment(formId, qid, aq => {
            const updated = { ...aq, [field]: value, dirty: true, dirtyFields: { ...aq.dirtyFields, [field]: true } };
            if (field === 'appointmentType') {
                updated.isMultipleOrGroup = value === 'multiple' || value === 'group';
            }
            return updated;
        });
    }

    // ── Per-form interval actions ─────────────────────────────

    handleIntervalDaysChange(event) {
        const { formId, qid, ivKey } = event.currentTarget.dataset;
        const newDays = event.detail.value;
        this.updateAppointment(formId, qid, aq => ({
            ...aq,
            intervals: aq.intervals.map(iv => iv.key === ivKey ? { ...iv, days: newDays } : iv),
            dirty: true,
            dirtyFields: { ...aq.dirtyFields, intervals: true }
        }));
    }

    handleIntervalTimeChange(event) {
        const { formId, qid, ivKey, timeField } = event.currentTarget.dataset;
        const value = event.target.value;
        this.updateAppointment(formId, qid, aq => ({
            ...aq,
            intervals: aq.intervals.map(iv => iv.key === ivKey ? { ...iv, [timeField]: value } : iv),
            dirty: true,
            dirtyFields: { ...aq.dirtyFields, intervals: true }
        }));
    }

    handleRemoveInterval(event) {
        const { formId, qid, ivKey } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({
            ...aq,
            intervals: aq.intervals.filter(iv => iv.key !== ivKey),
            dirty: true,
            dirtyFields: { ...aq.dirtyFields, intervals: true }
        }));
    }

    handlePerFormIntervalFrom(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({ ...aq, newIntervalFrom: event.target.value }));
    }

    handlePerFormIntervalTo(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({ ...aq, newIntervalTo: event.target.value }));
    }

    handlePerFormIntervalDays(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({ ...aq, newIntervalDays: event.detail.value }));
    }

    handlePerFormAddInterval(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => {
            if (!aq.newIntervalFrom || !aq.newIntervalTo || !aq.newIntervalDays || !aq.newIntervalDays.length) return aq;
            const newIv = {
                fromTime: aq.newIntervalFrom, toTime: aq.newIntervalTo,
                days: [...aq.newIntervalDays], key: formId + '-' + qid + '-iv-' + Date.now()
            };
            return {
                ...aq, intervals: [...aq.intervals, newIv],
                newIntervalFrom: null, newIntervalTo: null, newIntervalDays: [],
                dirty: true, dirtyFields: { ...aq.dirtyFields, intervals: true }
            };
        });
    }

    // ── Per-form blockout date actions ─────────────────────────

    handlePerFormStartDate(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({ ...aq, newStartDate: event.target.value }));
    }

    handlePerFormEndDate(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({ ...aq, newEndDate: event.target.value }));
    }

    handlePerFormAddBlockout(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => {
            if (!aq.newStartDate || !aq.newEndDate) return aq;
            if (aq.newEndDate < aq.newStartDate) {
                this.showToast('Error', 'End date cannot be before start date', 'error');
                return aq;
            }
            if (aq.blockoutDates.some(d => d.startDate === aq.newStartDate && d.endDate === aq.newEndDate)) {
                this.showToast('Info', 'This date range already exists', 'info');
                return aq;
            }
            const nd = {
                startDate: aq.newStartDate, endDate: aq.newEndDate,
                key: formId + '-' + qid + '-bd-' + Date.now(),
                label: aq.newStartDate === aq.newEndDate ? aq.newStartDate : aq.newStartDate + ' → ' + aq.newEndDate
            };
            return {
                ...aq, blockoutDates: [...aq.blockoutDates, nd],
                newStartDate: null, newEndDate: null,
                dirty: true, dirtyFields: { ...aq.dirtyFields, blockoutDates: true }
            };
        });
    }

    handleRemoveBlockout(event) {
        const { formId, qid, dateKey } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => ({
            ...aq, blockoutDates: aq.blockoutDates.filter(d => d.key !== dateKey),
            dirty: true, dirtyFields: { ...aq.dirtyFields, blockoutDates: true }
        }));
    }

    updateAppointment(formId, qid, updater) {
        this.forms = this.forms.map(f => {
            if (f.formId !== formId) return f;
            return { ...f, appointments: f.appointments.map(aq => aq.qid !== qid ? aq : updater(aq)) };
        });
    }

    // ── Save ──────────────────────────────────────────────────

    async handleSave() {
        const requests = [];
        for (const form of this.forms) {
            for (const aq of form.appointments) {
                if (!aq.dirty) continue;
                const properties = {};
                const df = aq.dirtyFields;

                if (df.blockoutDates) {
                    properties.blockoutDates = JSON.stringify(
                        aq.blockoutDates.map(d => ({ startDate: d.startDate, endDate: d.endDate }))
                    );
                }
                if (df.intervals) {
                    properties.intervals = JSON.stringify(
                        aq.intervals.map(iv => ({ from: iv.fromTime, to: iv.toTime, days: iv.days }))
                    );
                }
                if (df.appointmentType) properties.appointmentType = aq.appointmentType;
                if (df.slotDuration) properties.slotDuration = aq.slotDuration;
                if (df.maxAttendee) properties.maxAttendee = aq.maxAttendee;
                if (df.rollingDays) properties.rollingDays = aq.rollingDays;
                if (df.minScheduleNotice) properties.minScheduleNotice = aq.minScheduleNotice;

                requests.push({ formId: form.formId, questionId: aq.qid, properties });
            }
        }

        if (requests.length === 0) {
            this.showToast('Info', 'No changes to save', 'info');
            return;
        }

        this.isSaving = true;
        try {
            const results = await bulkUpdateAppointments({ requestsJson: JSON.stringify(requests) });
            let successCount = 0;
            let failCount = 0;
            const errors = [];

            for (const r of results) {
                if (r.success) {
                    successCount++;
                    this.updateAppointment(r.formId, r.questionId, aq => ({ ...aq, dirty: false, dirtyFields: {} }));
                } else {
                    failCount++;
                    errors.push(r.formId + ': ' + r.errorMessage);
                }
            }

            if (failCount === 0) {
                this.showToast('Success', successCount + ' form(s) updated successfully', 'success');
            } else {
                this.showToast('Warning', successCount + ' succeeded, ' + failCount + ' failed: ' + errors.join('; '), 'warning');
            }
        } catch (e) {
            this.showToast('Error', this.extractError(e), 'error');
        }
        this.isSaving = false;
    }

    async handleRefresh() {
        await this.loadForms();
        this.showToast('Success', 'Forms reloaded', 'success');
    }

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
