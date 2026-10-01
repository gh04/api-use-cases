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

    _cachedData = [];

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
            const filtered = data.filter(f => f.appointments && f.appointments.length > 0);
            this._cachedData = JSON.parse(JSON.stringify(filtered));
            this.forms = filtered.map(f => this.buildFormEntry(f));
        } catch (e) {
            this.error = this.extractError(e);
        }
        this.isLoading = false;
    }

    buildFormEntry(f) {
        const appointments = f.appointments.map(aq => this.buildAppointmentEntry(f.formId, aq));
        const hasDirty = appointments.some(aq => aq.dirty);
        return {
            formId: f.formId,
            formName: f.formName,
            errorMessage: f.errorMessage,
            selected: false,
            expanded: false,
            expandIcon: 'utility:chevronright',
            hasDirty,
            cardClass: hasDirty ? 'form-card form-card-dirty' : 'form-card',
            appointments
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
            newIntervalDayChecks: this._buildNewIntervalDayChecks(aq.intervals || [], []),
            newStartDate: null,
            newEndDate: null,
            newIntervalFrom: null,
            newIntervalTo: null,
            newIntervalDays: [],
            dirty: false,
            dirtyFields: {}
        };
    }

    _buildNewIntervalDayChecks(intervals, selectedDays) {
        const usedDays = new Set();
        for (const iv of intervals) {
            for (const d of (iv.days || [])) {
                usedDays.add(d);
            }
        }
        const selected = new Set(selectedDays || []);
        return ALL_DAYS.map(d => ({
            label: d,
            value: d,
            disabled: usedDays.has(d),
            checked: selected.has(d),
            key: 'newiv-day-' + d
        }));
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
    get undoDisabled() { return this.isSaving || !this.forms.some(f => f.appointments.some(aq => aq.dirty)); }

    // ── Validation helpers ────────────────────────────────────

    _timeToMinutes(timeStr) {
        if (!timeStr) return null;
        const parts = timeStr.split(':');
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    }

    _validateTimeRange(fromTime, toTime, slotDuration) {
        const fromMin = this._timeToMinutes(fromTime);
        const toMin = this._timeToMinutes(toTime);
        if (fromMin === null || toMin === null) return null;
        if (toMin <= fromMin) {
            return 'End time must be after start time';
        }
        if (slotDuration) {
            const duration = parseInt(slotDuration, 10);
            if (duration > 0 && (toMin - fromMin) < duration) {
                return 'Time range must be at least ' + duration + ' minutes (slot duration)';
            }
        }
        return null;
    }

    _datesOverlap(start1, end1, start2, end2) {
        return start1 <= end2 && start2 <= end1;
    }

    _validateIntervalDayConflict(existingIntervals, newDays) {
        const existingDaySet = new Set();
        for (const iv of existingIntervals) {
            for (const day of iv.days) {
                existingDaySet.add(day);
            }
        }
        const conflicts = newDays.filter(d => existingDaySet.has(d));
        if (conflicts.length > 0) {
            return 'These days already have intervals: ' + conflicts.join(', ')
                + '. Uncheck them from the existing interval first, then add a new one.';
        }
        return null;
    }

    _validateBlockoutOverlap(existingDates, newStart, newEnd) {
        for (const d of existingDates) {
            if (this._datesOverlap(newStart, newEnd, d.startDate, d.endDate)) {
                return 'Overlaps with existing blockout ' + d.startDate + ' to ' + d.endDate;
            }
        }
        return null;
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
        let skippedOverlap = 0;
        this.forms = this.forms.map(f => {
            if (!f.selected) return f;
            const appointments = f.appointments.map(aq => {
                const overlapMsg = this._validateBlockoutOverlap(aq.blockoutDates, nd.startDate, nd.endDate);
                if (overlapMsg) {
                    skippedOverlap++;
                    return aq;
                }
                const updated = [...aq.blockoutDates, {
                    ...nd, key: f.formId + '-' + aq.qid + '-bd-' + Date.now(),
                    label: nd.startDate === nd.endDate ? nd.startDate : nd.startDate + ' → ' + nd.endDate
                }];
                return { ...aq, blockoutDates: updated, dirty: true, dirtyFields: { ...aq.dirtyFields, blockoutDates: true } };
            });
            const hasDirty = appointments.some(aq => aq.dirty);
            return { ...f, appointments, hasDirty, cardClass: hasDirty ? 'form-card form-card-dirty' : 'form-card' };
        });
        this.bulkStartDate = null;
        this.bulkEndDate = null;
        if (skippedOverlap > 0) {
            this.showToast('Warning', 'Added to selected forms. ' + skippedOverlap + ' skipped due to overlapping dates.', 'warning');
        } else {
            this.showToast('Success', 'Blockout dates added to selected forms', 'success');
        }
    }

    handleBulkClearBlockout() {
        this.forms = this.forms.map(f => {
            if (!f.selected) return f;
            const appointments = f.appointments.map(aq => {
                if (aq.blockoutDates.length === 0) return aq;
                return { ...aq, blockoutDates: [], dirty: true, dirtyFields: { ...aq.dirtyFields, blockoutDates: true } };
            });
            const hasDirty = appointments.some(aq => aq.dirty);
            return { ...f, appointments, hasDirty, cardClass: hasDirty ? 'form-card form-card-dirty' : 'form-card' };
        });
        this.showToast('Success', 'Blockout dates cleared on selected forms', 'success');
    }

    // ── Bulk interval actions ─────────────────────────────────

    handleBulkIntervalFrom(event) { this.bulkIntervalFrom = event.target.value; }
    handleBulkIntervalTo(event) { this.bulkIntervalTo = event.target.value; }
    handleBulkIntervalDays(event) { this.bulkIntervalDays = event.detail.value; }

    handleBulkAddInterval() {
        if (!this.bulkIntervalFrom || !this.bulkIntervalTo || !this.bulkIntervalDays.length) return;
        const timeErr = this._validateTimeRange(this.bulkIntervalFrom, this.bulkIntervalTo);
        if (timeErr) {
            this.showToast('Error', timeErr, 'error');
            return;
        }
        const newIv = { fromTime: this.bulkIntervalFrom, toTime: this.bulkIntervalTo, days: [...this.bulkIntervalDays] };
        let skippedConflict = 0;
        this.forms = this.forms.map(f => {
            if (!f.selected) return f;
            const appointments = f.appointments.map(aq => {
                const dayConflict = this._validateIntervalDayConflict(aq.intervals, newIv.days);
                if (dayConflict) {
                    skippedConflict++;
                    return aq;
                }
                const updatedIntervals = [...aq.intervals, { ...newIv, key: f.formId + '-' + aq.qid + '-iv-' + Date.now() }];
                return { ...aq, intervals: updatedIntervals, newIntervalDayChecks: this._buildNewIntervalDayChecks(updatedIntervals, aq.newIntervalDays), dirty: true, dirtyFields: { ...aq.dirtyFields, intervals: true } };
            });
            const hasDirty = appointments.some(aq => aq.dirty);
            return { ...f, appointments, hasDirty, cardClass: hasDirty ? 'form-card form-card-dirty' : 'form-card' };
        });
        this.bulkIntervalFrom = null;
        this.bulkIntervalTo = null;
        this.bulkIntervalDays = [];
        if (skippedConflict > 0) {
            this.showToast('Warning', 'Added to selected forms. ' + skippedConflict + ' skipped — days already have intervals. Uncheck those days from existing intervals first.', 'warning');
        } else {
            this.showToast('Success', 'Interval added to selected forms', 'success');
        }
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
        this.updateAppointment(formId, qid, aq => {
            const updated = aq.intervals.map(iv => {
                if (iv.key !== ivKey) return iv;
                const newIv = { ...iv, [timeField]: value };
                const err = this._validateTimeRange(newIv.fromTime, newIv.toTime, aq.slotDuration);
                if (err && newIv.fromTime && newIv.toTime) {
                    this.showToast('Warning', err, 'warning');
                }
                return newIv;
            });
            return { ...aq, intervals: updated, dirty: true, dirtyFields: { ...aq.dirtyFields, intervals: true } };
        });
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

    handleNewIntervalDayToggle(event) {
        const { formId, qid, dayValue } = event.currentTarget.dataset;
        const isChecked = event.target.checked;
        this.updateAppointment(formId, qid, aq => {
            let days = [...(aq.newIntervalDays || [])];
            if (isChecked) {
                if (!days.includes(dayValue)) days.push(dayValue);
            } else {
                days = days.filter(d => d !== dayValue);
            }
            return { ...aq, newIntervalDays: days };
        });
    }

    handlePerFormAddInterval(event) {
        const { formId, qid } = event.currentTarget.dataset;
        this.updateAppointment(formId, qid, aq => {
            if (!aq.newIntervalFrom || !aq.newIntervalTo) {
                this.showToast('Error', 'Both From and To times are required', 'error');
                return aq;
            }
            if (!aq.newIntervalDays || !aq.newIntervalDays.length) {
                this.showToast('Error', 'Select at least one day', 'error');
                return aq;
            }
            const timeErr = this._validateTimeRange(aq.newIntervalFrom, aq.newIntervalTo, aq.slotDuration);
            if (timeErr) {
                this.showToast('Error', timeErr, 'error');
                return aq;
            }
            const dayConflict = this._validateIntervalDayConflict(aq.intervals, aq.newIntervalDays);
            if (dayConflict) {
                this.showToast('Error', dayConflict, 'error');
                return aq;
            }
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
            if (!aq.newStartDate || !aq.newEndDate) {
                this.showToast('Error', 'Both start and end dates are required', 'error');
                return aq;
            }
            if (aq.newEndDate < aq.newStartDate) {
                this.showToast('Error', 'End date cannot be before start date', 'error');
                return aq;
            }
            const overlapMsg = this._validateBlockoutOverlap(aq.blockoutDates, aq.newStartDate, aq.newEndDate);
            if (overlapMsg) {
                this.showToast('Error', overlapMsg, 'error');
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
            const appointments = f.appointments.map(aq => {
                if (aq.qid !== qid) return aq;
                const updated = updater(aq);
                updated.newIntervalDayChecks = this._buildNewIntervalDayChecks(updated.intervals, updated.newIntervalDays);
                return updated;
            });
            const hasDirty = appointments.some(aq => aq.dirty);
            return { ...f, appointments, hasDirty, cardClass: hasDirty ? 'form-card form-card-dirty' : 'form-card' };
        });
    }

    // ── Undo ──────────────────────────────────────────────────

    handleUndo() {
        this.forms = this._cachedData.map(f => {
            const current = this.forms.find(cf => cf.formId === f.formId);
            const entry = this.buildFormEntry(f);
            if (current) {
                entry.selected = current.selected;
                entry.expanded = current.expanded;
                entry.expandIcon = current.expandIcon;
            }
            return entry;
        });
        this.showToast('Info', 'All changes reverted', 'info');
    }

    handleUndoForm(event) {
        const formId = event.currentTarget.dataset.formId;
        const cached = this._cachedData.find(f => f.formId === formId);
        if (!cached) return;
        this.forms = this.forms.map(f => {
            if (f.formId !== formId) return f;
            const entry = this.buildFormEntry(cached);
            entry.selected = f.selected;
            entry.expanded = f.expanded;
            entry.expandIcon = f.expandIcon;
            return entry;
        });
        this.showToast('Info', 'Changes reverted for this form', 'info');
    }

    // ── Save ──────────────────────────────────────────────────

    _validateBeforeSave(form) {
        for (const aq of form.appointments) {
            if (!aq.dirty) continue;
            for (const iv of aq.intervals) {
                const err = this._validateTimeRange(iv.fromTime, iv.toTime, aq.slotDuration);
                if (err) {
                    return form.formName + ' — ' + aq.text + ': ' + err;
                }
                if (!iv.days || iv.days.length === 0) {
                    return form.formName + ' — ' + aq.text + ': Interval has no days selected';
                }
            }
        }
        return null;
    }

    async handleSaveForm(event) {
        const formId = event.currentTarget.dataset.formId;
        const form = this.forms.find(f => f.formId === formId);
        if (!form) return;

        const validationErr = this._validateBeforeSave(form);
        if (validationErr) {
            this.showToast('Error', validationErr, 'error');
            return;
        }

        const requests = [];
        for (const aq of form.appointments) {
            if (!aq.dirty) continue;
            const properties = this._buildProperties(aq);
            requests.push({ formId: form.formId, questionId: aq.qid, properties });
        }

        if (requests.length === 0) {
            this.showToast('Info', 'No changes to save', 'info');
            return;
        }

        this.isSaving = true;
        try {
            const results = await bulkUpdateAppointments({ requestsJson: JSON.stringify(requests) });
            let failCount = 0;
            const errors = [];
            for (const r of results) {
                if (r.success) {
                    this.updateAppointment(r.formId, r.questionId, aq => ({ ...aq, dirty: false, dirtyFields: {} }));
                } else {
                    failCount++;
                    errors.push(r.errorMessage);
                }
            }
            if (failCount === 0) {
                this._updateCache(formId);
                this.showToast('Success', 'Form updated successfully', 'success');
            } else {
                this.showToast('Warning', failCount + ' failed: ' + errors.join('; '), 'warning');
            }
        } catch (e) {
            this.showToast('Error', this.extractError(e), 'error');
        }
        this.isSaving = false;
    }

    async handleSave() {
        for (const form of this.forms) {
            const validationErr = this._validateBeforeSave(form);
            if (validationErr) {
                this.showToast('Error', validationErr, 'error');
                return;
            }
        }

        const requests = [];
        for (const form of this.forms) {
            for (const aq of form.appointments) {
                if (!aq.dirty) continue;
                requests.push({ formId: form.formId, questionId: aq.qid, properties: this._buildProperties(aq) });
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
                this._updateCacheAll();
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

    _buildProperties(aq) {
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
        return properties;
    }

    _formToCache(form) {
        return {
            formId: form.formId,
            formName: form.formName,
            errorMessage: form.errorMessage,
            appointments: form.appointments.map(aq => ({
                qid: aq.qid, name: aq.name, text: aq.text,
                appointmentType: aq.appointmentType, slotDuration: aq.slotDuration,
                maxAttendee: aq.maxAttendee, rollingDays: aq.rollingDays,
                minScheduleNotice: aq.minScheduleNotice,
                intervals: aq.intervals.map(iv => ({ fromTime: iv.fromTime, toTime: iv.toTime, days: [...iv.days] })),
                blockoutDates: aq.blockoutDates.map(d => ({ startDate: d.startDate, endDate: d.endDate }))
            }))
        };
    }

    _updateCache(formId) {
        const form = this.forms.find(f => f.formId === formId);
        if (!form) return;
        const idx = this._cachedData.findIndex(f => f.formId === formId);
        if (idx >= 0) {
            this._cachedData[idx] = this._formToCache(form);
        }
    }

    _updateCacheAll() {
        this._cachedData = this.forms.map(f => this._formToCache(f));
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
