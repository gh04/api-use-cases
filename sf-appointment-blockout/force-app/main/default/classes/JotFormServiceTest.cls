@isTest
private class JotFormServiceTest {

    private static final String QUESTIONS_RESPONSE = '{"responseCode":200,"message":"success","content":{' +
        '"1":{"type":"control_head","text":"Header","qid":"1","name":"heading"},' +
        '"72":{"type":"control_appointment","text":"Schedule Appointment","qid":"72","name":"appointment72",' +
            '"blockoutDates":"[{\\"startDate\\":\\"2026-12-25\\",\\"endDate\\":\\"2026-12-25\\"}]"},' +
        '"5":{"type":"control_textbox","text":"Name","qid":"5","name":"name"}' +
    '}}';

    private static final String QUESTION_DETAIL_RESPONSE = '{"responseCode":200,"message":"success","content":{' +
        '"type":"control_appointment","text":"Schedule Appointment","qid":"72","name":"appointment72",' +
        '"blockoutDates":"[{\\"startDate\\":\\"2026-12-25\\",\\"endDate\\":\\"2026-12-25\\"}]"' +
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

    private class MultipleMock implements HttpCalloutMock {
        private final List<String> responses;
        private Integer callIndex = 0;

        MultipleMock(List<String> responses) {
            this.responses = responses;
        }

        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            String body = (callIndex < responses.size())
                ? responses[callIndex]
                : SUCCESS_RESPONSE;
            callIndex++;
            res.setBody(body);
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

        System.assertEquals(1, results.size());
        System.assertEquals('72', results[0].qid);
        System.assertEquals('Schedule Appointment', results[0].text);
        System.assertEquals(1, results[0].blockoutDates.size());
        System.assertEquals('2026-12-25', results[0].blockoutDates[0].startDate);
    }

    @isTest
    static void testGetBlockoutDates() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(200, QUESTION_DETAIL_RESPONSE));
        Test.startTest();
        List<JotFormService.BlockoutDate> dates =
            JotFormService.getBlockoutDates('123456789', '72');
        Test.stopTest();

        System.assertEquals(1, dates.size());
        System.assertEquals('2026-12-25', dates[0].startDate);
        System.assertEquals('2026-12-25', dates[0].endDate);
    }

    @isTest
    static void testUpdateBlockoutDates() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(200, SUCCESS_RESPONSE));
        Test.startTest();
        List<JotFormService.BlockoutDate> dates = new List<JotFormService.BlockoutDate>{
            new JotFormService.BlockoutDate('2026-12-25', '2026-12-25'),
            new JotFormService.BlockoutDate('2026-12-31', '2027-01-01')
        };
        JotFormService.updateBlockoutDates('123456789', '72', dates);
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
        Forms__c testForm = new Forms__c(
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
        System.assertEquals('Test Form', results[0].formName);
        System.assertEquals(1, results[0].appointments.size());
    }

    @isTest
    static void testLoadAllFormsWithApiError() {
        Forms__c testForm = new Forms__c(
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
    static void testBulkUpdateBlockoutDates() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(200, SUCCESS_RESPONSE));
        String requestsJson = '[{"formId":"123","questionId":"72","dates":[{"startDate":"2026-12-25","endDate":"2026-12-25"}]}]';
        Test.startTest();
        List<JotFormService.BulkUpdateResult> results =
            JotFormService.bulkUpdateBlockoutDates(requestsJson);
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(true, results[0].success);
        System.assertEquals('123', results[0].formId);
    }

    @isTest
    static void testBulkUpdateWithFailure() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(401, ERROR_RESPONSE));
        String requestsJson = '[{"formId":"123","questionId":"72","dates":[]}]';
        Test.startTest();
        List<JotFormService.BulkUpdateResult> results =
            JotFormService.bulkUpdateBlockoutDates(requestsJson);
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
        System.assertNotEquals(null, results[0].appointmentsJson);
    }

    @isTest
    static void testUpdateBlockoutInvocable() {
        Test.setMock(HttpCalloutMock.class, new SingleMock(200, SUCCESS_RESPONSE));
        JotFormUpdateBlockoutAction.UpdateBlockoutRequest req = new JotFormUpdateBlockoutAction.UpdateBlockoutRequest();
        req.formId = '123456789';
        req.questionId = '72';
        req.blockoutDatesJson = '[{"startDate":"2026-12-25","endDate":"2026-12-25"}]';
        Test.startTest();
        List<JotFormUpdateBlockoutAction.UpdateBlockoutResult> results =
            JotFormUpdateBlockoutAction.updateBlockoutDates(
                new List<JotFormUpdateBlockoutAction.UpdateBlockoutRequest>{ req }
            );
        Test.stopTest();

        System.assertEquals(true, results[0].success);
    }
}
