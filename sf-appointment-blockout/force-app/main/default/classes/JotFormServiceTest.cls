@isTest
private class JotFormServiceTest {

    private static final String QUESTIONS_RESPONSE = '{"responseCode":200,"message":"success","content":{' +
        '"1":{"type":"control_head","text":"Header","qid":"1","name":"heading"},' +
        '"72":{"type":"control_appointment","text":"Schedule Appointment","qid":"72","name":"appointment72",' +
            '"appointmentType":"single","slotDuration":"30","maxAttendee":"5","rollingDays":"90","minScheduleNotice":"0",' +
            '"intervals":"[{\\"from\\":\\"10:00\\",\\"to\\":\\"12:00\\",\\"days\\":[\\"Tue\\",\\"Wed\\"]}]",' +
            '"blockoutDates":"[{\\"startDate\\":\\"2026-12-25\\",\\"endDate\\":\\"2026-12-25\\"}]"},' +
        '"67":{"type":"control_appointment","text":"Book Room","qid":"67","name":"appointment67",' +
            '"appointmentType":"multiple","slotDuration":"90","maxAttendee":"30","rollingDays":"","minScheduleNotice":"",' +
            '"intervals":"[{\\"from\\":\\"10:00\\",\\"to\\":\\"16:00\\",\\"days\\":[\\"Mon\\",\\"Tue\\",\\"Wed\\",\\"Thu\\",\\"Fri\\"]}]",' +
            '"blockoutDates":"[{\\"startDate\\":\\"\\",\\"endDate\\":\\"\\"}]"},' +
        '"5":{"type":"control_textbox","text":"Name","qid":"5","name":"name"}' +
    '}}';

    private static final String SUCCESS_RESPONSE = '{"responseCode":200,"message":"success","content":{}}';
    private static final String ERROR_RESPONSE = '{"responseCode":401,"message":"Invalid API key"}';

    private class SingleMock implements HttpCalloutMock {
        private final Integer statusCode;
        private final String body;

        SingleMock(Integer statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body;
        }

        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(this.statusCode);
            res.setHeader('Content-Type', 'application/json');
            res.setBody(this.body);
            return res;
        }
    }

    @isTest
    static void testGetAppointmentQuestions() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(200, QUESTIONS_RESPONSE));
        Test.startTest();
        List<JotFormService.AppointmentQuestion> results =
            JotFormService.getAppointmentQuestions('123456789');
        Test.stopTest();

        System.assertEquals(2, results.size());

        JotFormService.AppointmentQuestion aq72;
        JotFormService.AppointmentQuestion aq67;
        for (JotFormService.AppointmentQuestion aq : results) {
            if (aq.qid == '72') aq72 = aq;
            if (aq.qid == '67') aq67 = aq;
        }

        System.assertNotEquals(null, aq72);
        System.assertEquals('single', aq72.appointmentType);
        System.assertEquals('30', aq72.slotDuration);
        System.assertEquals('5', aq72.maxAttendee);
        System.assertEquals('90', aq72.rollingDays);
        System.assertEquals(1, aq72.blockoutDates.size());
        System.assertEquals(1, aq72.intervals.size());
        System.assertEquals('10:00', aq72.intervals[0].fromTime);
        System.assertEquals(2, aq72.intervals[0].days.size());

        System.assertNotEquals(null, aq67);
        System.assertEquals('multiple', aq67.appointmentType);
        System.assertEquals('30', aq67.maxAttendee);
        System.assertEquals(0, aq67.blockoutDates.size(), 'Empty startDate entries should be filtered');
        System.assertEquals(5, aq67.intervals[0].days.size());
    }

    @isTest
    static void testUpdateQuestionProperties() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(200, SUCCESS_RESPONSE));
        Test.startTest();
        Map<String, String> props = new Map<String, String>{
            'slotDuration' => '60',
            'maxAttendee' => '10',
            'blockoutDates' => '[{"startDate":"2026-12-25","endDate":"2026-12-25"}]'
        };
        JotFormService.updateQuestionProperties('123', '72', props);
        Test.stopTest();
    }

    @isTest
    static void testApiError() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(401, ERROR_RESPONSE));
        Test.startTest();
        try {
            JotFormService.getAppointmentQuestions('123456789');
            System.assert(false, 'Should have thrown');
        } catch (JotFormService.JotFormException e) {
            System.assertEquals('Invalid API key', e.getMessage());
        }
        Test.stopTest();
    }

    @isTest
    static void testLoadAllFormsWithAppointments() {
        Form__c testForm = new Form__c(
            Name = 'Test Form',
            Form_ID__c = '999999999',
            Status__c = 'Enabled'
        );
        insert testForm;

        Test.setMock(HttpCalloutMock.class, new SingleMock(200, QUESTIONS_RESPONSE));
        Test.startTest();
        List<JotFormService.FormAppointmentData> results =
            JotFormService.loadAllFormsWithAppointments();
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals('999999999', results[0].formId);
        System.assertEquals(2, results[0].appointments.size());
    }

    @isTest
    static void testLoadAllFormsWithApiError() {
        Form__c testForm = new Form__c(
            Name = 'Bad Form',
            Form_ID__c = '000000000',
            Status__c = 'Enabled'
        );
        insert testForm;

        Test.setMock(HttpCalloutMock.class, new SingleMock(401, ERROR_RESPONSE));
        Test.startTest();
        List<JotFormService.FormAppointmentData> results =
            JotFormService.loadAllFormsWithAppointments();
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertNotEquals(null, results[0].errorMessage);
        System.assertEquals(0, results[0].appointments.size());
    }

    @isTest
    static void testBulkUpdateAppointments() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(200, SUCCESS_RESPONSE));
        String requestsJson = '[{"formId":"123","questionId":"72","properties":{' +
            '"blockoutDates":"[{\\"startDate\\":\\"2026-12-25\\",\\"endDate\\":\\"2026-12-25\\"}]",' +
            '"slotDuration":"60",' +
            '"intervals":"[{\\"from\\":\\"10:00\\",\\"to\\":\\"12:00\\",\\"days\\":[\\"Mon\\",\\"Tue\\"]}]"' +
        '}}]';
        Test.startTest();
        List<JotFormService.BulkUpdateResult> results =
            JotFormService.bulkUpdateAppointments(requestsJson);
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(true, results[0].success);
        System.assertEquals('123', results[0].formId);
    }

    @isTest
    static void testBulkUpdateWithFailure() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(401, ERROR_RESPONSE));
        String requestsJson = '[{"formId":"123","questionId":"72","properties":{"slotDuration":"60"}}]';
        Test.startTest();
        List<JotFormService.BulkUpdateResult> results =
            JotFormService.bulkUpdateAppointments(requestsJson);
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(false, results[0].success);
        System.assertEquals('Invalid API key', results[0].errorMessage);
    }

    @isTest
    static void testGetAppointmentsInvocable() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(200, QUESTIONS_RESPONSE));
        JotFormBlockoutAction.GetAppointmentsRequest req = new JotFormBlockoutAction.GetAppointmentsRequest();
        req.formId = '123456789';
        Test.startTest();
        List<JotFormBlockoutAction.GetAppointmentsResult> results =
            JotFormBlockoutAction.getAppointmentQuestions(new List<JotFormBlockoutAction.GetAppointmentsRequest>{ req });
        Test.stopTest();

        System.assertEquals(true, results[0].success);
    }

    @isTest
    static void testParseEmptyIntervals() {
        String resp = '{"responseCode":200,"message":"success","content":{' +
            '"1":{"type":"control_appointment","text":"Test","qid":"1","name":"test",' +
                '"appointmentType":"single","slotDuration":"30","maxAttendee":"1","rollingDays":"","minScheduleNotice":"",' +
                '"intervals":"[]","blockoutDates":"[]"}' +
        '}}';
        Test.setMock(HttpCalloutMock.class, new SingleMock(200, resp));
        Test.startTest();
        List<JotFormService.AppointmentQuestion> results =
            JotFormService.getAppointmentQuestions('123');
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(0, results[0].intervals.size());
        System.assertEquals(0, results[0].blockoutDates.size());
    }
}
