public with sharing class JotFormService {

    private static final String NAMED_CREDENTIAL = 'callout:JotForm_API';

    public class JotFormException extends Exception {}

    // ── Data types ────────────────────────────────────────────────

    public class BlockoutDate {
        @AuraEnabled public String startDate;
        @AuraEnabled public String endDate;

        public BlockoutDate() {}

        public BlockoutDate(String startDate, String endDate) {
            this.startDate = startDate;
            this.endDate = endDate;
        }
    }

    public class IntervalSlot {
        @AuraEnabled public String fromTime;
        @AuraEnabled public String toTime;
        @AuraEnabled public List<String> days;

        public IntervalSlot() {
            this.days = new List<String>();
        }
    }

    public class AppointmentQuestion {
        @AuraEnabled public String qid;
        @AuraEnabled public String name;
        @AuraEnabled public String text;
        @AuraEnabled public String appointmentType;
        @AuraEnabled public String slotDuration;
        @AuraEnabled public String maxAttendee;
        @AuraEnabled public String rollingDays;
        @AuraEnabled public String minScheduleNotice;
        @AuraEnabled public List<BlockoutDate> blockoutDates;
        @AuraEnabled public List<IntervalSlot> intervals;
    }

    public class FormAppointmentData {
        @AuraEnabled public String formId;
        @AuraEnabled public String formName;
        @AuraEnabled public List<AppointmentQuestion> appointments;
        @AuraEnabled public String errorMessage;
    }

    public class BulkUpdateResult {
        @AuraEnabled public String formId;
        @AuraEnabled public String questionId;
        @AuraEnabled public Boolean success;
        @AuraEnabled public String errorMessage;
    }

    // ── HTTP layer ────────────────────────────────────────────────

    private static HttpResponse sendRequest(String method, String path) {
        return sendRequest(method, path, null);
    }

    private static HttpResponse sendRequest(String method, String path, String body) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(NAMED_CREDENTIAL + path);
        req.setMethod(method);
        req.setTimeout(30000);
        if (body != null) {
            req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
            req.setBody(body);
        }
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            String msg = 'JotForm API error (' + res.getStatusCode() + ')';
            try {
                Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
                if (parsed.containsKey('message')) {
                    msg = (String) parsed.get('message');
                }
            } catch (Exception e) {
                // use default msg
            }
            throw new JotFormException(msg);
        }
        return res;
    }

    // ── Core methods ──────────────────────────────────────────────

    public static List<AppointmentQuestion> getAppointmentQuestions(String formId) {
        HttpResponse res = sendRequest('GET', '/v1/form/' + formId + '/questions');
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        Map<String, Object> content = (Map<String, Object>) parsed.get('content');

        List<AppointmentQuestion> results = new List<AppointmentQuestion>();
        if (content == null) {
            return results;
        }

        for (String qid : content.keySet()) {
            Map<String, Object> question = (Map<String, Object>) content.get(qid);
            if (question == null) {
                continue;
            }
            if ((String) question.get('type') != 'control_appointment') {
                continue;
            }
            results.add(parseAppointmentQuestion(qid, question));
        }
        return results;
    }

    public static void updateQuestionProperties(String formId, String questionId, Map<String, String> properties) {
        String body = '';
        for (String key : properties.keySet()) {
            if (body.length() > 0) {
                body += '&';
            }
            body += 'question[' + key + ']=' + EncodingUtil.urlEncode(properties.get(key), 'UTF-8');
        }
        sendRequest('POST', '/v1/form/' + formId + '/question/' + questionId, body);
    }

    // ── AuraEnabled methods for LWC ───────────────────────────────

    @AuraEnabled
    public static List<FormAppointmentData> loadAllFormsWithAppointments() {
        List<Map<String, String>> formRecords = getFormRecords();

        List<FormAppointmentData> results = new List<FormAppointmentData>();
        for (Map<String, String> rec : formRecords) {
            FormAppointmentData data = new FormAppointmentData();
            data.formId = rec.get('formId');
            data.formName = rec.get('formName');
            try {
                data.appointments = getAppointmentQuestions(data.formId);
            } catch (Exception e) {
                data.appointments = new List<AppointmentQuestion>();
                data.errorMessage = e.getMessage();
            }
            results.add(data);
        }
        return results;
    }

    @AuraEnabled
    public static List<BulkUpdateResult> bulkUpdateAppointments(String requestsJson) {
        List<Object> rawRequests = (List<Object>) JSON.deserializeUntyped(requestsJson);
        List<BulkUpdateResult> results = new List<BulkUpdateResult>();

        for (Object rawReq : rawRequests) {
            Map<String, Object> reqMap = (Map<String, Object>) rawReq;
            BulkUpdateResult result = new BulkUpdateResult();
            result.formId = (String) reqMap.get('formId');
            result.questionId = (String) reqMap.get('questionId');

            try {
                Map<String, Object> propsRaw = (Map<String, Object>) reqMap.get('properties');
                Map<String, String> properties = new Map<String, String>();
                for (String key : propsRaw.keySet()) {
                    Object val = propsRaw.get(key);
                    properties.put(key, (val instanceof String) ? (String) val : JSON.serialize(val));
                }
                updateQuestionProperties(result.formId, result.questionId, properties);
                result.success = true;
            } catch (Exception e) {
                result.success = false;
                result.errorMessage = e.getMessage();
            }
            results.add(result);
        }
        return results;
    }

    // ── Private helpers ───────────────────────────────────────────

    private static List<Map<String, String>> getFormRecords() {
        List<Map<String, String>> records = new List<Map<String, String>>();
        for (SObject obj : Database.query(
            'SELECT Form_ID__c, Name FROM Form__c WHERE Status__c = \'Enabled\' ORDER BY Name'
        )) {
            Map<String, String> rec = new Map<String, String>();
            rec.put('formId', (String) obj.get('Form_ID__c'));
            rec.put('formName', (String) obj.get('Name'));
            records.add(rec);
        }
        return records;
    }

    private static AppointmentQuestion parseAppointmentQuestion(String qid, Map<String, Object> q) {
        AppointmentQuestion aq = new AppointmentQuestion();
        aq.qid = qid;
        aq.name = (String) q.get('name');
        aq.text = (String) q.get('text');
        aq.appointmentType = (String) q.get('appointmentType');
        aq.slotDuration = (String) q.get('slotDuration');
        aq.maxAttendee = (String) q.get('maxAttendee');
        aq.rollingDays = (String) q.get('rollingDays');
        aq.minScheduleNotice = (String) q.get('minScheduleNotice');
        aq.blockoutDates = parseBlockoutDates((String) q.get('blockoutDates'));
        aq.intervals = parseIntervals((String) q.get('intervals'));
        return aq;
    }

    private static List<BlockoutDate> parseBlockoutDates(String raw) {
        List<BlockoutDate> dates = new List<BlockoutDate>();
        if (String.isBlank(raw) || raw == '[]') {
            return dates;
        }
        try {
            List<Object> parsed = (List<Object>) JSON.deserializeUntyped(raw);
            for (Object item : parsed) {
                Map<String, Object> dateMap = (Map<String, Object>) item;
                BlockoutDate bd = new BlockoutDate();
                bd.startDate = (String) dateMap.get('startDate');
                bd.endDate = (String) dateMap.get('endDate');
                if (String.isNotBlank(bd.startDate)) {
                    dates.add(bd);
                }
            }
        } catch (Exception e) {
            // malformed JSON
        }
        return dates;
    }

    private static List<IntervalSlot> parseIntervals(String raw) {
        List<IntervalSlot> slots = new List<IntervalSlot>();
        if (String.isBlank(raw) || raw == '[]') {
            return slots;
        }
        try {
            List<Object> parsed = (List<Object>) JSON.deserializeUntyped(raw);
            for (Object item : parsed) {
                Map<String, Object> slotMap = (Map<String, Object>) item;
                IntervalSlot slot = new IntervalSlot();
                slot.fromTime = (String) slotMap.get('from');
                slot.toTime = (String) slotMap.get('to');
                slot.days = new List<String>();
                List<Object> daysList = (List<Object>) slotMap.get('days');
                if (daysList != null) {
                    for (Object d : daysList) {
                        slot.days.add((String) d);
                    }
                }
                slots.add(slot);
            }
        } catch (Exception e) {
            // malformed JSON
        }
        return slots;
    }
}
